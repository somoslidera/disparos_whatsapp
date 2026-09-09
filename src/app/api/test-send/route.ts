import { fail, handle, ok } from "@/lib/api";
import { testSendSchema } from "@/lib/schemas";
import { deliverMessage } from "@/lib/campaign-runner";
import { toContactJid, toSendNumber } from "@/lib/phone";

export const dynamic = "force-dynamic";

/** Envia a mensagem para um único número (teste antes do disparo). */
export const POST = handle(async (req: Request) => {
  const parsed = testSendSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return fail(parsed.error.issues[0]?.message || "Dados inválidos");
  const { number, message } = parsed.data;
  if (!message.text.trim() && message.attachments.length === 0) return fail("Escreva uma mensagem ou anexe um arquivo.");
  await deliverMessage(toSendNumber(toContactJid(number)), message, new Map());
  return ok({ ok: true });
});
