import { z } from "zod";
import { fail, getCreds, handle, ok } from "@/lib/api";
import { agentKeyConfigured, isAgentAuthorized } from "@/lib/agent-auth";
import { LANC_RULE, resolveGroup } from "@/lib/agent";
import { markNotes, storeAvailable } from "@/lib/agent-store";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const schema = z
  .object({
    grupo: z.string().trim().min(1).optional(),
    grupoId: z.string().trim().min(1).optional(),
    ids: z.array(z.string().trim().min(1)).min(1, "Informe pelo menos 1 id.").max(50, "No máximo 50 ids por chamada."),
    status: z.enum(["lancada", "ignorada"], { message: 'status deve ser "lancada" ou "ignorada".' }),
    observacao: z.string().max(500).optional(),
  })
  .refine((v) => v.grupo || v.grupoId, { message: "Informe grupo (nome exato) ou grupoId." });

/** POST /api/agente/lancamentos/marcar — marca notas como lançadas ou ignoradas (saem de /pendentes). Não envia nada. */
export const POST = handle(async (req: Request) => {
  if (!agentKeyConfigured()) return fail("DISPAROS_AGENT_KEY não configurada no servidor.", 503);
  if (!isAgentAuthorized(req)) return fail("Não autorizado.", 401);
  const creds = getCreds(req);
  if (!creds.url || !creds.token) return fail("UAZAPI_URL e UAZAPI_TOKEN precisam estar configurados no servidor.", 503);
  if (!storeAvailable(req)) return fail("Armazenamento (Vercel Blob) indisponível.", 503);

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail(parsed.error.issues[0]?.message || "Corpo inválido.", 400);
  const input = parsed.data;

  const resolved = await resolveGroup(creds, input, LANC_RULE);
  if (!resolved.ok) return fail(resolved.message, resolved.status, resolved.status === 422 ? { parecidos: resolved.parecidos } : {});
  const g = resolved.group;

  const data = new Date().toISOString();
  const ids = [...new Set(input.ids)];
  await markNotes(req, ids.map((id) => ({ id, grupoId: g.id, grupo: g.name, status: input.status, observacao: input.observacao, data })));
  return ok({ ok: true, grupo: g.name, grupoId: g.id, status: input.status, marcadas: ids.length });
});
