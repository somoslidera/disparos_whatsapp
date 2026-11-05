import { createHash } from "node:crypto";
import { z } from "zod";
import { fail, getCreds, handle, ok } from "@/lib/api";
import { agentKeyConfigured, isAgentAuthorized } from "@/lib/agent-auth";
import { formatSaoPaulo, LANC_RULE, RATE_LIMIT_PER_HOUR, resolveGroup } from "@/lib/agent";
import { appendLog, checkRateLimit, claimReference, finishReference, markNotes, newRecordId, releaseReference, storeAvailable, type AgentRecord } from "@/lib/agent-store";
import { sendText } from "@/lib/uazapi";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const schema = z
  .object({
    grupo: z.string().trim().min(1).optional(),
    grupoId: z.string().trim().min(1).optional(),
    ids: z.array(z.string().trim().min(1)).min(1, "Informe pelo menos 1 id.").max(50, "No máximo 50 ids por chamada."),
    observacao: z.string().max(300, "observacao com no máximo 300 caracteres.").optional(),
  })
  .refine((v) => v.grupo || v.grupoId, { message: "Informe grupo (nome exato) ou grupoId." });

export function confirmationText(n: number, observacao?: string) {
  const base = n === 1 ? "✅ Recebemos e já lançamos 1 item. Obrigado!" : `✅ Recebemos e já lançamos ${n} itens. Obrigado!`;
  const obs = observacao?.trim();
  return obs ? `${base}\n\n${obs}` : base;
}

/**
 * POST /api/agente/lancamentos/confirmar — uma confirmação por lote no grupo "Lançamentos - …"
 * e marca as notas do lote como lançadas. O texto é montado pelo servidor; o agente só pode
 * acrescentar uma observação curta. O mesmo lote (mesmos ids) nunca é confirmado duas vezes.
 */
export const POST = handle(async (req: Request) => {
  if (!agentKeyConfigured()) return fail("DISPAROS_AGENT_KEY não configurada no servidor.", 503);
  if (!isAgentAuthorized(req)) return fail("Não autorizado.", 401);
  const creds = getCreds(req);
  if (!creds.url || !creds.token) return fail("UAZAPI_URL e UAZAPI_TOKEN precisam estar configurados no servidor.", 503);
  if (!storeAvailable(req)) return fail("Armazenamento (Vercel Blob) indisponível.", 503);

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail(parsed.error.issues[0]?.message || "Corpo inválido.", 400);
  const input = parsed.data;

  const rate = await checkRateLimit(req, RATE_LIMIT_PER_HOUR, "confirmar");
  if (!rate.allowed) return fail(`Limite de ${RATE_LIMIT_PER_HOUR} confirmações por hora atingido.`, 429);

  const resolved = await resolveGroup(creds, input, LANC_RULE);
  if (!resolved.ok) return fail(resolved.message, resolved.status, resolved.status === 422 ? { parecidos: resolved.parecidos } : {});
  const g = resolved.group;

  const ids = [...new Set(input.ids)].sort();
  const referencia = `confirma-${createHash("sha256").update(`${g.id}|${ids.join("|")}`).digest("hex").slice(0, 20)}`;
  const texto = confirmationText(ids.length, input.observacao);
  const now = new Date();
  const base: AgentRecord = {
    id: newRecordId(),
    tipo: "agente",
    data: now.toISOString(),
    referencia,
    grupo: g.name,
    grupoId: g.id,
    teste: false,
    blocos: 1,
    textos: [texto],
    status: "enviando",
    enviados: 0,
    mensagens: [],
  };

  const claim = await claimReference(req, referencia, base);
  if (!claim.claimed) {
    const prev = claim.existing;
    await appendLog(req, { ...base, status: "duplicado", anterior: { id: prev.id, data: prev.data, status: prev.status, enviados: prev.enviados, mensagens: prev.mensagens } });
    return fail("Esse lote já foi confirmado no grupo. Nada foi enviado.", 409, { referencia, anterior: { enviadoEm: formatSaoPaulo(new Date(prev.data)), status: prev.status } });
  }

  try {
    const res = await sendText(creds, g.id, texto);
    const raw = (res.raw || {}) as { status?: unknown };
    const mensagem = { bloco: 1, id: res.messageId, status: typeof raw.status === "string" ? raw.status : "enviado" };
    const record: AgentRecord = { ...base, status: "concluido", enviados: 1, mensagens: [mensagem] };
    await finishReference(req, referencia, record);
    await appendLog(req, record);
    await markNotes(req, ids.map((id) => ({ id, grupoId: g.id, grupo: g.name, status: "lancada" as const, data: now.toISOString() })));
    return ok({ ok: true, grupo: g.name, grupoId: g.id, referencia, itens: ids.length, texto, mensagem, enviadoEm: formatSaoPaulo(now) });
  } catch (err) {
    const erro = (err as Error).message;
    await releaseReference(req, referencia);
    await appendLog(req, { ...base, status: "falha", mensagens: [{ bloco: 1, status: "falha", erro }], erro });
    return fail(`Falha ao enviar a confirmação: ${erro}. As notas não foram marcadas.`, 502, { referencia });
  }
});
