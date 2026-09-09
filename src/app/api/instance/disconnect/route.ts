import { getCreds, handle, ok } from "@/lib/api";
import { disconnectInstance } from "@/lib/uazapi";

export const dynamic = "force-dynamic";

export const POST = handle(async (req: Request) => {
  await disconnectInstance(getCreds(req));
  return ok({ ok: true });
});
