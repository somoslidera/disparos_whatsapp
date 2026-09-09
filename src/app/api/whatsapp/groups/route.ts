import { handle, ok } from "@/lib/api";
import { listGroups } from "@/lib/uazapi";

export const dynamic = "force-dynamic";

export const GET = handle(async (req: Request) => {
  const force = new URL(req.url).searchParams.get("force") === "1";
  return ok({ groups: await listGroups(force) });
});
