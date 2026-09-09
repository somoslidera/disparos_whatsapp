import { nanoid } from "nanoid";
import { fail, handle, ok } from "@/lib/api";
import { readDb, updateDb } from "@/lib/db";
import { campaignInputSchema } from "@/lib/schemas";
import { resolveRecipients } from "@/lib/audiences";
import { recoverInterruptedCampaigns, startCampaign } from "@/lib/campaign-runner";
import { getInstanceStatus } from "@/lib/uazapi";
import type { Campaign } from "@/lib/types";

export const dynamic = "force-dynamic";

function summarize(c: Campaign) {
  const counts = { total: c.recipients.length, sent: 0, failed: 0, pending: 0, cancelled: 0 };
  for (const r of c.recipients) {
    if (r.status === "sent") counts.sent++;
    else if (r.status === "failed") counts.failed++;
    else if (r.status === "cancelled") counts.cancelled++;
    else counts.pending++;
  }
  return { ...c, recipients: undefined, counts };
}

export const GET = handle(async () => {
  await recoverInterruptedCampaigns();
  const db = await readDb();
  return ok({ campaigns: db.campaigns.map(summarize) });
});

export const POST = handle(async (req: Request) => {
  const parsed = campaignInputSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return fail(parsed.error.issues[0]?.message || "Dados inválidos");
  const input = parsed.data;

  if (!input.message.text.trim() && input.message.attachments.length === 0) {
    return fail("Escreva uma mensagem ou anexe um arquivo.");
  }
  if (input.settings.delayMinSeconds > input.settings.delayMaxSeconds) {
    return fail("O intervalo mínimo não pode ser maior que o máximo.");
  }

  const status = await getInstanceStatus();
  if (!status.connected) {
    return fail("O WhatsApp não está conectado. Conecte a instância antes de disparar.", 409);
  }

  const db = await readDb();
  const recipients = resolveRecipients(input.selection, db.audiences).map((r) => ({ ...r, status: "pending" as const }));
  if (recipients.length === 0) return fail("A seleção não contém nenhum destinatário.");

  const campaign: Campaign = {
    id: nanoid(10),
    name: input.name || `Disparo ${new Date().toLocaleString("pt-BR")}`,
    message: input.message,
    recipients,
    settings: input.settings,
    status: "queued",
    createdAt: new Date().toISOString(),
    sources: input.selection.map((s) => ({ type: s.type, id: s.id, name: s.name })),
  };
  await updateDb((d) => {
    d.campaigns.unshift(campaign);
  });
  startCampaign(campaign);
  return ok({ campaign: summarize(campaign) }, { status: 201 });
});
