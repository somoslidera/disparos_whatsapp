import { getCreds, handle, ok } from "@/lib/api";
import { listGroups } from "@/lib/uazapi";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export const GET = handle(async (req: Request) => {
  const force = new URL(req.url).searchParams.get("force") === "1";
  return ok({ groups: await listGroups(getCreds(req), force) });
});
