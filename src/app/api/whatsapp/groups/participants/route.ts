import { fail, getCreds, handle, ok } from "@/lib/api";
import { isGroupJid } from "@/lib/phone";
import { getGroupParticipants } from "@/lib/uazapi";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export const GET = handle(async (req: Request) => {
  const jid = new URL(req.url).searchParams.get("jid") || "";
  if (!isGroupJid(jid)) return fail("Informe o jid do grupo (termina em @g.us).");
  return ok({ participants: await getGroupParticipants(getCreds(req), jid) });
});
