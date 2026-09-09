import { handle, ok } from "@/lib/api";
import { disconnectInstance } from "@/lib/uazapi";

export const dynamic = "force-dynamic";

export const POST = handle(async () => {
  await disconnectInstance();
  return ok({ ok: true });
});
