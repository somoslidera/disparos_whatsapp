import { sendMedia, sendText, type Creds, type MediaType } from "./uazapi";
import type { SendInput } from "./schemas";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function mediaTypeFor(att: SendInput["attachments"][number]): MediaType {
  if (att.kind === "audio") return att.asVoice === false ? "audio" : "ptt";
  return att.kind;
}

/**
 * Entrega a mensagem completa (texto + anexos) para um destinatário.
 * A legenda vai no primeiro anexo que aceita legenda (imagem, vídeo ou documento);
 * áudios não aceitam legenda, então o texto é enviado em mensagem separada.
 */
export async function deliverMessage(creds: Creds, number: string, input: SendInput): Promise<void> {
  const text = input.text.trim();
  const attachments = input.attachments;

  if (attachments.length === 0) {
    if (!text) throw new Error("Mensagem vazia.");
    await sendText(creds, number, text);
    return;
  }

  const captionIdx = attachments.findIndex((a) => a.kind !== "audio");
  let captionSent = false;

  for (let i = 0; i < attachments.length; i++) {
    const att = attachments[i];
    const useCaption = i === captionIdx && Boolean(text);
    await sendMedia(creds, {
      number,
      type: mediaTypeFor(att),
      file: (att.url || att.dataUrl) as string,
      caption: useCaption ? text : undefined,
      fileName: att.kind === "document" ? att.name : undefined,
      mimetype: att.mime,
    });
    if (useCaption) captionSent = true;
    if (i < attachments.length - 1) await sleep(1200);
  }

  if (text && !captionSent) {
    await sleep(800);
    await sendText(creds, number, text);
  }
}
