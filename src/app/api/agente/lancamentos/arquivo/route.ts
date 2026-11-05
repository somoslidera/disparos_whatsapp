import { fail, getCreds, handle } from "@/lib/api";
import { agentKeyConfigured, isAgentAuthorized } from "@/lib/agent-auth";
import { READ_RULE, resolveGroup } from "@/lib/agent";
import { fileNameOf, hasFile, MAX_PER_GROUP } from "@/lib/lancamentos";
import { downloadMessageMedia, findMessages } from "@/lib/uazapi";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET /api/agente/lancamentos/arquivo?grupoId=<jid>&id=<mensagem> — devolve a foto/PDF da nota.
 * Só baixa mídia de mensagens entre as 200 mais recentes de um grupo "Lançamentos - …" ou PLL (somente leitura).
 */
export const GET = handle(async (req: Request) => {
  if (!agentKeyConfigured()) return fail("DISPAROS_AGENT_KEY não configurada no servidor.", 503);
  if (!isAgentAuthorized(req)) return fail("Não autorizado.", 401);
  const creds = getCreds(req);
  if (!creds.url || !creds.token) return fail("UAZAPI_URL e UAZAPI_TOKEN precisam estar configurados no servidor.", 503);

  const sp = new URL(req.url).searchParams;
  const id = sp.get("id")?.trim();
  const grupo = sp.get("grupo")?.trim() || undefined;
  const grupoId = sp.get("grupoId")?.trim() || undefined;
  if (!id) return fail("Informe id (id da mensagem, vindo de /pendentes).", 400);
  if (!grupo && !grupoId) return fail("Informe grupoId (ou grupo) da mensagem.", 400);

  const resolved = await resolveGroup(creds, { grupo, grupoId }, READ_RULE);
  if (!resolved.ok) return fail(resolved.message, resolved.status, resolved.status === 422 ? { parecidos: resolved.parecidos } : {});

  const page = await findMessages(creds, resolved.group.id, MAX_PER_GROUP, 0);
  const msg = page.messages.find((m) => m.id === id);
  if (!msg) return fail("Mensagem não encontrada entre as 200 mais recentes desse grupo.", 404);
  if (!hasFile(msg)) return fail("Essa mensagem não tem arquivo (foto, PDF, áudio ou vídeo).", 422);

  const media = await downloadMessageMedia(creds, id);
  const mime = media.mimetype.split(";")[0].trim().toLowerCase() || msg.mimetype || "application/octet-stream";
  const name = fileNameOf({ ...msg, mimetype: msg.mimetype || mime });
  return new Response(Buffer.from(media.bytes), {
    headers: {
      "Content-Type": mime,
      "Content-Length": String(media.bytes.byteLength),
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
      "Cache-Control": "no-store",
    },
  });
});
