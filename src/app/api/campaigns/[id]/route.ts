import { fail, handle, ok } from "@/lib/api";
import { readDb, updateDb } from "@/lib/db";
import { isRunning } from "@/lib/campaign-runner";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export const GET = handle(async (_req: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  const db = await readDb();
  const campaign = db.campaigns.find((c) => c.id === id);
  if (!campaign) return fail("Campanha não encontrada", 404);
  return ok({ campaign, running: isRunning(id) });
});

export const DELETE = handle(async (_req: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  if (isRunning(id)) return fail("Cancele a campanha antes de excluí-la.", 409);
  const removed = await updateDb((db) => {
    const before = db.campaigns.length;
    db.campaigns = db.campaigns.filter((c) => c.id !== id);
    return db.campaigns.length !== before;
  });
  return removed ? ok({ ok: true }) : fail("Campanha não encontrada", 404);
});
