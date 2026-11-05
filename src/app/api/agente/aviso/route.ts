import { z } from "zod";
import { fail, getCreds, handle, ok } from "@/lib/api";
import { agentKeyConfigured, isAgentAuthorized } from "@/lib/agent-auth";
import { formatSaoPaulo, MAX_BLOCK_CHARS, RATE_LIMIT_PER_HOUR, resolveGroup } from "@/lib/agent";
import { appendLog, checkRateLimit, claimReference, finishReference, newRecordId, releaseReference, storeAvailable, type AgentRecord } from "@/lib/agent-store";
import { sendText } from "@/lib/uazapi";
import { onlyDigits } from "@/lib/phone";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const schema = z
  .object({
    texto: z
      .string({ message: "texto é obrigatório." })
      .refine((t) => t.trim().length > 0, "texto vazio.")
      .refine((t) => t.length <= MAX_BLOCK_CHARS, `texto acima de ${MAX_BLOCK_CHARS} caracteres.`),
    grupo: z.string().trim().min(1).optional(),
    grupoId: z.string().trim().min(1).optional(),
    referencia: z.string({ message: "referencia é obrigatória." }).trim().min(3, "referencia precisa ter pelo menos 3 caracteres.").max(140),
  })
  .refine((v) => v.grupo || v.grupoId, { message: "Informe grupo (nome exato) ou grupoId do grupo sobre o qual é o aviso." });

/**
 * POST /api/agente/aviso — aviso interno: o agente leu algo importante num grupo de cliente e avisa VOCÊ.
 * O destino é fixo no servidor (DISPAROS_AVISO_NUMERO, ou DISPAROS_TESTE_NUMERO); o corpo não escolhe destino.
 * Nunca envia para o grupo nem para clientes. Referência única evita avisar duas vezes sobre a mesma coisa.
 */
export const POST = handle(async (req: Request) => {
  if (!agentKeyConfigured()) return fail("DISPAROS_AGENT_KEY não configurada no servidor.", 503);
  if (!isAgentAuthorized(req)) return fail("Não autorizado.", 401);

  const creds = getCreds(req);
  if (!creds.url || !creds.token) return fail("UAZAPI_URL e UAZAPI_TOKEN precisam estar configurados no servidor.", 503);
  if (!storeAvailable(req)) return fail("Armazenamento (Vercel Blob) indisponível: o histórico e a trava de referência dependem dele.", 503);

  const destino = onlyDigits(process.env.DISPAROS_AVISO_NUMERO || process.env.DISPAROS_TESTE_NUMERO || "");
  if (destino.length < 10) return fail("DISPAROS_AVISO_NUMERO (ou DISPAROS_TESTE_NUMERO) não configurado no servidor (DDI+DDD+número).", 503);

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail(parsed.error.issues[0]?.message || "Corpo inválido.", 400, { detalhes: parsed.error.issues.map((i) => i.message) });
  const input = parsed.data;

  const rate = await checkRateLimit(req, RATE_LIMIT_PER_HOUR, "aviso");
  if (!rate.allowed) return fail(`Limite de ${RATE_LIMIT_PER_HOUR} avisos por hora atingido.`, 429);

  // O grupo serve de contexto do aviso e segue a mesma trava de prefixo das outras rotas.
  const resolved = await resolveGroup(creds, { grupo: input.grupo, grupoId: input.grupoId });
  if (!resolved.ok) return fail(resolved.message, resolved.status, resolved.status === 422 ? { parecidos: resolved.parecidos } : {});
  const group = resolved.group;

  const now = new Date();
  const texto = `🔔 Aviso do agente\nGrupo: ${group.name}\n\n${input.texto.trim()}`;
  const refKey = `aviso-${input.referencia}`;
  const base: AgentRecord = {
    id: newRecordId(),
    tipo: "agente",
    data: now.toISOString(),
    referencia: refKey,
    grupo: group.name,
    grupoId: group.id,
    teste: false,
    blocos: 1,
    textos: [texto],
    status: "enviando",
    enviados: 0,
    mensagens: [],
  };

  const claim = await claimReference(req, refKey, base);
  if (!claim.claimed) {
    const prev = claim.existing;
    await appendLog(req, { ...base, status: "aviso_duplicado", anterior: { id: prev.id, data: prev.data, status: prev.status, enviados: prev.enviados, mensagens: prev.mensagens } });
    return fail(`Já existe um aviso com a referência "${input.referencia}". Nada foi enviado.`, 409, {
      referencia: input.referencia,
      anterior: { enviadoEm: formatSaoPaulo(new Date(prev.data)), grupo: prev.grupo, status: prev.status },
    });
  }

  try {
    const res = await sendText(creds, destino, texto);
    const raw = (res.raw || {}) as { status?: unknown };
    const mensagem = { bloco: 1, id: res.messageId, status: typeof raw.status === "string" ? raw.status : "enviado" };
    const record: AgentRecord = { ...base, status: "aviso", enviados: 1, mensagens: [mensagem] };
    await finishReference(req, refKey, record);
    await appendLog(req, record);
    return ok({ ok: true, aviso: true, grupo: group.name, grupoId: group.id, referencia: input.referencia, mensagem, enviadoEm: formatSaoPaulo(now) });
  } catch (err) {
    const erro = (err as Error).message;
    await releaseReference(req, refKey);
    await appendLog(req, { ...base, status: "aviso_falha", mensagens: [{ bloco: 1, status: "falha", erro }], erro });
    return fail(`Falha ao enviar o aviso: ${erro}`, 502, { referencia: input.referencia });
  }
});
