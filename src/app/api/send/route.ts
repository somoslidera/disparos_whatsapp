import { fail, getCreds, handle, ok } from "@/lib/api";
import { deliverMessage } from "@/lib/deliver";
import { sendSchema } from "@/lib/schemas";
import { toContactJid, toSendNumber } from "@/lib/phone";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Envia a mensagem (texto + anexos) para UM destinatário. O navegador orquestra a campanha. */
export const POST = handle(async (req: Request) => {
  const parsed = sendSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return fail(parsed.error.issues[0]?.message || "Dados inválidos");
  const input = parsed.data;
  if (!input.text.trim() && input.attachments.length === 0) return fail("Escreva uma mensagem ou anexe um arquivo.");
  await deliverMessage(getCreds(req), toSendNumber(toContactJid(input.to)), input);
  return ok({ ok: true });
});
