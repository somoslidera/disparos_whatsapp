import { fail, handle, ok } from "@/lib/api";
import { updateDb } from "@/lib/db";
import { audienceInputSchema } from "@/lib/schemas";
import { wouldCreateCycle } from "@/lib/audiences";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export const PUT = handle(async (req: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  const parsed = audienceInputSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return fail(parsed.error.issues[0]?.message || "Dados inválidos");

  const result = await updateDb((db) => {
    const idx = db.audiences.findIndex((a) => a.id === id);
    if (idx < 0) return { error: "Lista não encontrada" as const };
    for (const m of parsed.data.members) {
      if (m.type === "audience" && wouldCreateCycle(id, m.id, db.audiences)) {
        return { error: `A lista "${m.name}" já contém esta lista (referência circular).` };
      }
    }
    db.audiences[idx] = { ...db.audiences[idx], ...parsed.data, updatedAt: new Date().toISOString() };
    return { audience: db.audiences[idx] };
  });
  if ("error" in result && result.error) return fail(result.error, result.error === "Lista não encontrada" ? 404 : 400);
  return ok(result);
});

export const DELETE = handle(async (_req: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  const found = await updateDb((db) => {
    const before = db.audiences.length;
    db.audiences = db.audiences.filter((a) => a.id !== id);
    // Remove referências em outras listas
    for (const a of db.audiences) a.members = a.members.filter((m) => !(m.type === "audience" && m.id === id));
    return db.audiences.length !== before;
  });
  return found ? ok({ ok: true }) : fail("Lista não encontrada", 404);
});
