import { fail, getCreds, handle, ok } from "@/lib/api";
import { agentKeyConfigured, isAgentAuthorized } from "@/lib/agent-auth";
import { formatSaoPaulo, LANC_RULE, resolveGroup } from "@/lib/agent";
import { storeAvailable } from "@/lib/agent-store";
import { capFiles, collectPending, DEFAULT_DAYS, DEFAULT_PER_GROUP, lancamentosStart, MAX_FILES_CAP, MAX_PER_GROUP } from "@/lib/lancamentos";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET /api/agente/lancamentos/pendentes — tudo que os clientes mandaram nos grupos "Lançamentos - …" (fotos e PDFs de
 * notas, textos com despesas em qualquer formato) e ainda não foi marcado como lançado ou ignorado. Somente leitura.
 * Mensagens enviadas por este número e por contatos da equipe ("... - Lidera") ficam de fora.
 * Parâmetros opcionais: grupo ou grupoId (um grupo só), desde (ISO; padrão 7 dias, nunca antes do início dos lançamentos), limitePorGrupo (1–200, padrão 100),
 * maxArquivos (1–100): no máximo esse número de fotos/PDFs na resposta; o resto fica para a próxima busca (campo "restantes").
 */
export const GET = handle(async (req: Request) => {
  if (!agentKeyConfigured()) return fail("DISPAROS_AGENT_KEY não configurada no servidor.", 503);
  if (!isAgentAuthorized(req)) return fail("Não autorizado.", 401);
  const creds = getCreds(req);
  if (!creds.url || !creds.token) return fail("UAZAPI_URL e UAZAPI_TOKEN precisam estar configurados no servidor.", 503);
  if (!storeAvailable(req)) return fail("Armazenamento (Vercel Blob) indisponível: o controle de notas lançadas depende dele.", 503);

  const sp = new URL(req.url).searchParams;
  const desdeRaw = sp.get("desde");
  const asked = desdeRaw ? Date.parse(desdeRaw) : Date.now() - DEFAULT_DAYS * 86400_000;
  if (!Number.isFinite(asked)) return fail("desde deve ser uma data/hora ISO (ex.: 2026-11-03T00:00:00-03:00).", 400);
  const since = Math.max(asked, lancamentosStart());
  const perRaw = sp.get("limitePorGrupo");
  const perGroup = perRaw === null ? DEFAULT_PER_GROUP : Number(perRaw);
  if (!Number.isInteger(perGroup) || perGroup < 1 || perGroup > MAX_PER_GROUP) return fail(`limitePorGrupo deve ser um número inteiro de 1 a ${MAX_PER_GROUP}.`, 400);

  const maxRaw = sp.get("maxArquivos");
  const maxFiles = maxRaw === null ? null : Number(maxRaw);
  if (maxFiles !== null && (!Number.isInteger(maxFiles) || maxFiles < 1 || maxFiles > MAX_FILES_CAP)) return fail(`maxArquivos deve ser um número inteiro de 1 a ${MAX_FILES_CAP}.`, 400);

  const grupo = sp.get("grupo")?.trim() || undefined;
  const grupoId = sp.get("grupoId")?.trim() || undefined;
  let only;
  if (grupo || grupoId) {
    const resolved = await resolveGroup(creds, { grupo, grupoId }, LANC_RULE);
    if (!resolved.ok) return fail(resolved.message, resolved.status, resolved.status === 422 ? { parecidos: resolved.parecidos } : {});
    only = resolved.group;
  }

  const all = await collectPending(req, creds, { since, perGroup, only });
  const withItems = all.filter((g) => g.itens.length > 0 || g.erro);
  const capped = maxFiles === null ? null : capFiles(withItems, maxFiles);
  const grupos = capped ? capped.grupos : withItems;
  return ok({
    ok: true,
    desde: formatSaoPaulo(new Date(since)),
    gruposVerificados: all.length,
    totalItens: grupos.reduce((n, g) => n + g.itens.length, 0),
    totalArquivos: grupos.reduce((n, g) => n + g.itens.filter((it) => it.temArquivo).length, 0),
    /** Pendentes que não couberam nesta resposta por causa de maxArquivos (busque de novo depois de marcar estes). */
    restantes: capped ? capped.restantes : { itens: 0, arquivos: 0 },
    temMais: capped ? capped.restantes.itens > 0 : false,
    grupos,
  });
});
