import { fail, getCreds, handle, ok } from "@/lib/api";
import { agentKeyConfigured, isAgentAuthorized } from "@/lib/agent-auth";
import { isAllowedGroup } from "@/lib/agent";
import { listGroups } from "@/lib/uazapi";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Grupos permitidos ao agente (nome começa com "PLL |" ou "PLL Flow |"). */
export const GET = handle(async (req: Request) => {
  if (!agentKeyConfigured()) return fail("DISPAROS_AGENT_KEY não configurada no servidor.", 503);
  if (!isAgentAuthorized(req)) return fail("Não autorizado.", 401);
  const creds = getCreds(req);
  if (!creds.url || !creds.token) return fail("UAZAPI_URL e UAZAPI_TOKEN precisam estar configurados no servidor.", 503);
  const groups = await listGroups(creds, new URL(req.url).searchParams.get("force") === "1");
  return ok(groups.filter((g) => isAllowedGroup(g.name)).map((g) => ({ nome: g.name, id: g.id, participantes: g.participants })));
});
