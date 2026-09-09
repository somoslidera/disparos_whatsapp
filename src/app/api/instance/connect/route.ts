import { handle, ok } from "@/lib/api";
import { connectInstance } from "@/lib/uazapi";

export const dynamic = "force-dynamic";

export const POST = handle(async (req: Request) => {
  const body = (await req.json().catch(() => ({}))) as { phone?: string };
  const status = await connectInstance(body.phone?.replace(/\D+/g, "") || undefined);
  return ok(status);
});
