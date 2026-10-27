import { fail, getCreds, handle, ok } from "@/lib/api";
import { agentKeyConfigured, isAgentAuthorized } from "@/lib/agent-auth";
import { agentSendSchema, formatSaoPaulo, RATE_LIMIT_PER_HOUR, resolveGroup, sendBlocks } from "@/lib/agent";
import { appendLog, checkRateLimit, claimReference, finishReference, newRecordId, releaseReference, storeAvailable, type AgentRecord } from "@/lib/agent-store";
import { onlyDigits } from "@/lib/phone";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/agente/enviar — envio de atas pelo agente, sem interface.
 * Autenticação: Authorization: Bearer <DISPAROS_AGENT_KEY>.
 */
export const POST = handle(async (req: Request) => {
  if (!agentKeyConfigured()) return fail("DISPAROS_AGENT_KEY não configurada no servidor.", 503);
  if (!isAgentAuthorized(req)) return fail("Não autorizado.", 401);

  const creds = getCreds(req);
  if (!creds.url || !creds.token) return fail("UAZAPI_URL e UAZAPI_TOKEN precisam estar configurados no servidor.", 503);
  if (!storeAvailable(req)) return fail("Armazenamento (Vercel Blob) indisponível: o histórico e a trava de referência dependem dele.", 503);

  const parsed = agentSendSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail(parsed.error.issues[0]?.message || "Corpo inválido.", 400, { detalhes: parsed.error.issues.map((i) => i.message) });
  const input = parsed.data;

  const rate = await checkRateLimit(req, RATE_LIMIT_PER_HOUR);
  if (!rate.allowed) return fail(`Limite de ${RATE_LIMIT_PER_HOUR} chamadas por hora atingido.`, 429);

  // Destino de teste
  const testNumber = onlyDigits(process.env.DISPAROS_TESTE_NUMERO || "");
  if (input.teste && testNumber.length < 10) return fail("DISPAROS_TESTE_NUMERO não configurado no servidor (DDI+DDD+número).", 503);

  // Resolve e valida o grupo (mesmo em teste)
  const resolved = await resolveGroup(creds, input);
  if (!resolved.ok) {
    return fail(resolved.message, resolved.status, resolved.status === 422 ? { parecidos: resolved.parecidos } : {});
  }
  const group = resolved.group;

  const now = new Date();
  const base: AgentRecord = {
    id: newRecordId(),
    tipo: "agente",
    data: now.toISOString(),
    referencia: input.referencia,
    grupo: group.name,
    grupoId: group.id,
    teste: input.teste,
    blocos: input.blocos.length,
    textos: input.blocos,
    status: "enviando",
    enviados: 0,
    mensagens: [],
  };

  // Teste: não usa a trava de referência (pode repetir) e vai para o número de teste
  if (input.teste) {
    const blocks = [...input.blocos];
    blocks[0] = `[TESTE] grupo: ${group.name}\n\n${blocks[0]}`;
    const { results, failed } = await sendBlocks(creds, testNumber, blocks);
    const enviadosTeste = results.filter((r) => r.status !== "falha" && r.status !== "nao_enviado").length;
    const record: AgentRecord = { ...base, status: failed ? "teste_falha" : "teste", enviados: enviadosTeste, mensagens: results, erro: results.find((r) => r.erro)?.erro };
    await appendLog(req, record);
    const body = {
      ok: !failed,
      teste: true,
      destino: testNumber,
      grupo: group.name,
      grupoId: group.id,
      referencia: input.referencia,
      enviados: record.enviados,
      mensagens: results,
      enviadoEm: formatSaoPaulo(now),
    };
    return failed ? fail(`Falha ao enviar o bloco ${results.find((r) => r.erro)?.bloco}: ${record.erro}`, 502, body) : ok(body);
  }

  // Envio real: reserva a referência (idempotência)
  const claim = await claimReference(req, input.referencia, base);
  if (!claim.claimed) {
    const prev = claim.existing;
    await appendLog(req, { ...base, status: "duplicado", anterior: { id: prev.id, data: prev.data, status: prev.status, enviados: prev.enviados, mensagens: prev.mensagens } });
    return fail(`Já existe um envio com a referência "${input.referencia}" (${prev.status === "enviando" ? "em andamento" : "concluído"}). Nada foi enviado.`, 409, {
      referencia: input.referencia,
      anterior: { data: prev.data, enviadoEm: formatSaoPaulo(new Date(prev.data)), grupo: prev.grupo, grupoId: prev.grupoId, status: prev.status, enviados: prev.enviados, mensagens: prev.mensagens },
    });
  }

  let results: Awaited<ReturnType<typeof sendBlocks>>["results"] = [];
  let failed = false;
  try {
    ({ results, failed } = await sendBlocks(creds, group.id, input.blocos));
  } catch (err) {
    await releaseReference(req, input.referencia);
    throw err;
  }

  const enviados = results.filter((r) => r.status !== "falha" && r.status !== "nao_enviado").length;
  const status: AgentRecord["status"] = !failed ? "concluido" : enviados > 0 ? "parcial" : "falha";
  const record: AgentRecord = { ...base, status, enviados, mensagens: results, erro: results.find((r) => r.erro)?.erro };
  await finishReference(req, input.referencia, record);
  await appendLog(req, record);

  const body = {
    ok: !failed,
    grupo: group.name,
    grupoId: group.id,
    referencia: input.referencia,
    enviados,
    mensagens: results,
    enviadoEm: formatSaoPaulo(now),
  };
  if (failed) {
    const first = results.find((r) => r.erro);
    return fail(`Falha ao enviar o bloco ${first?.bloco}: ${first?.erro}. ${enviados} de ${input.blocos.length} enviados; os seguintes não foram enviados.`, 502, body);
  }
  return ok(body);
});
