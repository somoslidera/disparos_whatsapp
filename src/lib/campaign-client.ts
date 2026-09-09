"use client";

import { nanoid } from "nanoid";
import { api } from "./client";
import { resolveRecipients, type SelectionItem } from "./audiences";
import { getAudiences, upsertCampaign } from "./store";
import type { Attachment, Campaign, CampaignSettings, MessageDraft } from "./types";

/**
 * Motor de campanhas no navegador: envia um destinatário por vez chamando /api/send,
 * com intervalo aleatório entre envios. A aba precisa permanecer aberta.
 */

type Run = { cancel: boolean };
const running = new Map<string, Run>();
const listeners = new Set<() => void>();

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function randomBetween(minSec: number, maxSec: number) {
  const min = Math.max(0, Math.min(minSec, maxSec));
  const max = Math.max(minSec, maxSec);
  return (min + Math.random() * (max - min)) * 1000;
}

export function isRunning(id: string) {
  return running.has(id);
}

export function cancelCampaign(id: string) {
  const run = running.get(id);
  if (!run) return false;
  run.cancel = true;
  return true;
}

export function subscribeRunning(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

function toPayload(text: string, attachments: Attachment[]) {
  return {
    text,
    attachments: attachments.map((a) => ({ name: a.name, mime: a.mime, kind: a.kind, asVoice: a.asVoice, dataUrl: a.dataUrl })),
  };
}

/** Envia a mensagem para um único número (teste). */
export async function sendOne(to: string, message: MessageDraft) {
  await api("/api/send", { method: "POST", body: JSON.stringify({ to, ...toPayload(message.text, message.attachments) }) });
}

export function createCampaign(input: { name: string; message: MessageDraft; selection: SelectionItem[]; settings: CampaignSettings }): Campaign {
  const recipients = resolveRecipients(input.selection, getAudiences()).map((r) => ({ ...r, status: "pending" as const }));
  if (recipients.length === 0) throw new Error("A seleção não contém nenhum destinatário.");
  if (!input.message.text.trim() && input.message.attachments.length === 0) throw new Error("Escreva uma mensagem ou anexe um arquivo.");
  return {
    id: nanoid(10),
    name: input.name.trim() || `Disparo ${new Date().toLocaleString("pt-BR")}`,
    message: {
      text: input.message.text,
      attachments: input.message.attachments.map(({ id, name, mime, size, kind, asVoice }) => ({ id, name, mime, size, kind, asVoice })),
    },
    recipients,
    settings: input.settings,
    status: "queued",
    createdAt: new Date().toISOString(),
    sources: input.selection.map((s) => ({ type: s.type, id: s.id, name: s.name })),
  };
}

export function startCampaign(campaign: Campaign, attachments: Attachment[]) {
  if (running.has(campaign.id)) return;
  const run: Run = { cancel: false };
  running.set(campaign.id, run);
  listeners.forEach((l) => l());
  const payload = toPayload(campaign.message.text, attachments);

  void (async () => {
    campaign.status = "running";
    campaign.startedAt = new Date().toISOString();
    upsertCampaign(campaign);

    const pending = campaign.recipients.filter((r) => r.status === "pending");
    for (let i = 0; i < pending.length; i++) {
      if (run.cancel) break;
      const recipient = pending[i];
      recipient.status = "sending";
      upsertCampaign(campaign);
      try {
        await api("/api/send", { method: "POST", body: JSON.stringify({ to: recipient.id, ...payload }) });
        recipient.status = "sent";
        recipient.sentAt = new Date().toISOString();
        recipient.error = undefined;
      } catch (err) {
        recipient.status = "failed";
        recipient.error = (err as Error).message || "Erro desconhecido";
      }
      upsertCampaign(campaign);
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
    upsertCampaign(campaign);
    running.delete(campaign.id);
    listeners.forEach((l) => l());
  })();
}

/** Aviso ao fechar a aba durante um disparo. */
if (typeof window !== "undefined") {
  window.addEventListener("beforeunload", (e) => {
    if (running.size > 0) {
      e.preventDefault();
      e.returnValue = "";
    }
  });
}
