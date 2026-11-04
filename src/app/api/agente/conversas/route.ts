import { fail, getCreds, handle, ok } from "@/lib/api";
import { agentKeyConfigured, isAgentAuthorized } from "@/lib/agent-auth";
import { formatSaoPaulo, resolveGroup } from "@/lib/agent";
import { findMessages, listContacts } from "@/lib/uazapi";
import { jidToPhone } from "@/lib/phone";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_LIMIT = 200;
const DEFAULT_LIMIT = 50;

/**
 * GET /api/agente/conversas — leitura das mensagens de um grupo de cliente, sem interface.
 * Autenticação: Authorization: Bearer <DISPAROS_AGENT_KEY>. Somente leitura: nada é enviado.
 * Mesma trava do envio: só grupos cujo nome começa com "PLL |" ou "PLL Flow |", um grupo por chamada.
 *
 * Parâmetros: grupo (nome exato) ou grupoId; limite (1–200, padrão 50); offset; desde (data/hora ISO).
 */
export const GET = handle(async (req: Request) => {
  if (!agentKeyConfigured()) return fail("DISPAROS_AGENT_KEY não configurada no servidor.", 503);
  if (!isAgentAuthorized(req)) return fail("Não autorizado.", 401);
  const creds = getCreds(req);
  if (!creds.url || !creds.token) return fail("UAZAPI_URL e UAZAPI_TOKEN precisam estar configurados no servidor.", 503);

  const sp = new URL(req.url).searchParams;
  const grupo = sp.get("grupo")?.trim() || undefined;
  const grupoId = sp.get("grupoId")?.trim() || undefined;
  if (!grupo && !grupoId) return fail("Informe grupo (nome exato) ou grupoId.", 400);

  const limiteRaw = sp.get("limite");
  const limite = limiteRaw === null ? DEFAULT_LIMIT : Number(limiteRaw);
  if (!Number.isInteger(limite) || limite < 1 || limite > MAX_LIMIT) return fail(`limite deve ser um número inteiro de 1 a ${MAX_LIMIT}.`, 400);
  const offsetRaw = sp.get("offset");
  const offset = offsetRaw === null ? 0 : Number(offsetRaw);
  if (!Number.isInteger(offset) || offset < 0) return fail("offset deve ser um número inteiro maior ou igual a 0.", 400);
  const desdeRaw = sp.get("desde");
  const desde = desdeRaw ? Date.parse(desdeRaw) : null;
  if (desdeRaw && !Number.isFinite(desde)) return fail("desde deve ser uma data/hora ISO (ex.: 2026-11-03T00:00:00-03:00).", 400);

  const resolved = await resolveGroup(creds, { grupo, grupoId });
  if (!resolved.ok) return fail(resolved.message, resolved.status, resolved.status === 422 ? { parecidos: resolved.parecidos } : {});
  const group = resolved.group;

  const [page, contacts] = await Promise.all([
    findMessages(creds, group.id, limite, offset),
    // Nome salvo na agenda (ex.: "João - Rota do Sabor PLL"); se a agenda falhar, segue com o nome do WhatsApp.
    listContacts(creds, false).catch(() => []),
  ]);
  const saved = new Map(contacts.map((c) => [c.phone, c.name]));

  const mensagens = page.messages
    .filter((m) => desde === null || m.timestamp >= desde)
    .sort((a, b) => a.timestamp - b.timestamp)
    .map((m) => {
      const numero = m.senderPhone || (m.fromMe ? "" : jidToPhone(m.senderJid));
      const nomeSalvo = numero ? saved.get(numero) : undefined;
      return {
        id: m.id,
        data: m.timestamp ? formatSaoPaulo(new Date(m.timestamp)) : null,
        deMim: m.fromMe,
        autor: m.fromMe ? "Eu" : (nomeSalvo && nomeSalvo !== numero ? nomeSalvo : "") || m.senderName || numero || "Desconhecido",
        autorNumero: m.fromMe ? null : numero || null,
        tipo: m.kind,
        texto: m.text,
        ...(m.fileName ? { arquivo: m.fileName } : {}),
        ...(m.quotedId ? { respondendo: m.quotedId } : {}),
      };
    });

  return ok({
    ok: true,
    grupo: group.name,
    grupoId: group.id,
    total: mensagens.length,
    temMais: page.hasMore,
    proximoOffset: page.nextOffset,
    mensagens,
  });
});
