import { fail, handle, ok } from "@/lib/api";
import { deleteUpload, readUpload } from "@/lib/uploads";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export const GET = handle(async (req: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  const mime = new URL(req.url).searchParams.get("mime") || "application/octet-stream";
  try {
    const buf = await readUpload(id);
    return new Response(new Uint8Array(buf), {
      headers: { "Content-Type": mime, "Cache-Control": "private, max-age=3600" },
    });
  } catch {
    return fail("Arquivo não encontrado", 404);
  }
});

export const DELETE = handle(async (_req: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  await deleteUpload(id);
  return ok({ ok: true });
});
