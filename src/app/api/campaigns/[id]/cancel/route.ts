import { fail, handle, ok } from "@/lib/api";
import { cancelCampaign } from "@/lib/campaign-runner";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export const POST = handle(async (_req: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  return cancelCampaign(id) ? ok({ ok: true }) : fail("Esta campanha não está em execução.", 409);
});
