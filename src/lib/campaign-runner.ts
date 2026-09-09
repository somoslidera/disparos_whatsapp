import { readDb, writeDb } from "./db";
import { sendMedia, sendText, type MediaType } from "./uazapi";
import { readUploadAsDataUri } from "./uploads";
import { toSendNumber } from "./phone";
import type { Attachment, Campaign, CampaignRecipient } from "./types";

/**
 * Executa campanhas em segundo plano, um destinatário por vez, com intervalo
 * aleatório entre envios (reduz risco de bloqueio pelo WhatsApp).
 */

type RunnerState = {
  running: Map<string, { cancel: boolean }>;
};

const g = globalThis as unknown as { __campaignRunner?: RunnerState };
const state: RunnerState = g.__campaignRunner ?? { running: new Map() };
g.__campaignRunner = state;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function randomBetween(minSec: number, maxSec: number): number {
  const min = Math.max(0, Math.min(minSec, maxSec));
  const max = Math.max(minSec, maxSec);
  return (min + Math.random() * (max - min)) * 1000;
}

async function persist(campaign: Campaign) {
  const db = await readDb();
  const idx = db.campaigns.findIndex((c) => c.id === campaign.id);
  if (idx >= 0) db.campaigns[idx] = campaign;
  else db.campaigns.unshift(campaign);
  await writeDb(db);
}

function mediaTypeFor(att: Attachment): MediaType {
  if (att.kind === "audio") return att.asVoice === false ? "audio" : "ptt";
  return att.kind;
}

/** Envia a mensagem completa (texto + anexos) para um destinatário. */
export async function deliverMessage(
  number: string,
  message: Campaign["message"],
  mediaCache: Map<string, string>,
): Promise<void> {
  const text = message.text.trim();
  const attachments = message.attachments ?? [];

  if (attachments.length === 0) {
    if (!text) throw new Error("Mensagem vazia.");
    await sendText(number, text);
    return;
  }

  // A legenda vai no primeiro anexo que aceita legenda (imagem, vídeo ou documento).
  const captionIdx = attachments.findIndex((a) => a.kind !== "audio");
  let captionSent = false;

  for (let i = 0; i < attachments.length; i++) {
    const att = attachments[i];
    let file = mediaCache.get(att.uploadId);
    if (!file) {
      file = await readUploadAsDataUri(att.uploadId, att.mime);
      mediaCache.set(att.uploadId, file);
    }
    const useCaption = i === captionIdx && Boolean(text);
    await sendMedia({
      number,
      type: mediaTypeFor(att),
      file,
      caption: useCaption ? text : undefined,
      fileName: att.kind === "document" ? att.name : undefined,
      mimetype: att.mime,
    });
    if (useCaption) captionSent = true;
    if (i < attachments.length - 1) await sleep(1200);
  }

  if (text && !captionSent) {
    await sleep(800);
    await sendText(number, text);
  }
}

export function isRunning(campaignId: string): boolean {
  return state.running.has(campaignId);
}

export function cancelCampaign(campaignId: string): boolean {
  const run = state.running.get(campaignId);
  if (!run) return false;
  run.cancel = true;
  return true;
}

export function startCampaign(campaign: Campaign): void {
  if (state.running.has(campaign.id)) return;
  const run = { cancel: false };
  state.running.set(campaign.id, run);

  void (async () => {
    const mediaCache = new Map<string, string>();
    campaign.status = "running";
    campaign.startedAt = new Date().toISOString();
    await persist(campaign);

    const pending = campaign.recipients.filter((r) => r.status === "pending");
    for (let i = 0; i < pending.length; i++) {
      const recipient: CampaignRecipient = pending[i];
      if (run.cancel) break;

      recipient.status = "sending";
      await persist(campaign);

      try {
        await deliverMessage(toSendNumber(recipient.id), campaign.message, mediaCache);
        recipient.status = "sent";
        recipient.sentAt = new Date().toISOString();
        recipient.error = undefined;
      } catch (err) {
        recipient.status = "failed";
        recipient.error = (err as Error).message || "Erro desconhecido";
      }
      await persist(campaign);

      if (i < pending.length - 1 && !run.cancel) {
        await sleep(randomBetween(campaign.settings.delayMinSeconds, campaign.settings.delayMaxSeconds));
      }
    }

    if (run.cancel) {
      for (const r of campaign.recipients) if (r.status === "pending" || r.status === "sending") r.status = "cancelled";
      campaign.status = "cancelled";
    } else {
      const allFailed = campaign.recipients.length > 0 && campaign.recipients.every((r) => r.status === "failed");
      campaign.status = allFailed ? "failed" : "completed";
    }
    campaign.finishedAt = new Date().toISOString();
    await persist(campaign);
    state.running.delete(campaign.id);
  })();
}

/** Ao reiniciar o servidor, campanhas que ficaram "rodando" são marcadas como interrompidas. */
export async function recoverInterruptedCampaigns(): Promise<void> {
  const db = await readDb();
  let changed = false;
  for (const c of db.campaigns) {
    if ((c.status === "running" || c.status === "queued") && !state.running.has(c.id)) {
      for (const r of c.recipients) if (r.status === "pending" || r.status === "sending") r.status = "cancelled";
      c.status = "cancelled";
      c.finishedAt = c.finishedAt ?? new Date().toISOString();
      changed = true;
    }
  }
  if (changed) await writeDb(db);
}
