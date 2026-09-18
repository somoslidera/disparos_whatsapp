"use client";

import { nanoid } from "nanoid";
import { api } from "./client";
import { resolveRecipients, type SelectionItem } from "./audiences";
import { idbDelete, idbGet, idbPut } from "./idb";
import { discardAttachment } from "./uploads-client";
import { personalize } from "./personalize";
import { getAudiences, getCampaigns, upsertCampaign } from "./store";
import type { Attachment, Campaign, CampaignSettings, MessageBlock, MessageDraft, StoredBlock } from "./types";

/**
 * Motor de campanhas no navegador: envia um destinatário por vez chamando /api/send
 * (um pedido por bloco), com intervalo aleatório entre destinatários.
 * Campanhas agendadas ficam guardadas no navegador e disparam no horário, com a aba aberta.
 */

type Run = { cancel: boolean };
const running = new Map<string, Run>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();
const listeners = new Set<() => void>();

/** Se a aba ficou fechada e o horário passou há mais que isso, o agendamento é cancelado. */
const LATE_TOLERANCE_MS = 2 * 60 * 60 * 1000;
const BLOCK_GAP_MS = [1500, 3000];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function randomBetween(minSec: number, maxSec: number) {
  const min = Math.max(0, Math.min(minSec, maxSec));
  const max = Math.max(minSec, maxSec);
  return (min + Math.random() * (max - min)) * 1000;
}

function notify() {
  listeners.forEach((l) => l());
}

export function isRunning(id: string) {
  return running.has(id);
}

export function subscribeRunning(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

type BlockPayload = {
  id: string;
  text: string;
  attachments: { name: string; mime: string; kind: Attachment["kind"]; asVoice?: boolean; url?: string; dataUrl?: string }[];
};

function toPayload(blocks: MessageBlock[]): BlockPayload[] {
  return blocks.map((b) => ({
    id: b.id,
    text: b.text,
    attachments: b.attachments.map((a) => ({ name: a.name, mime: a.mime, kind: a.kind, asVoice: a.asVoice, url: a.url, dataUrl: a.dataUrl })),
  }));
}

/** Apaga do armazenamento os arquivos de uma campanha finalizada. */
function discardBlobs(blocks: BlockPayload[]) {
  for (const b of blocks) for (const a of b.attachments) if (a.url) void discardAttachment({ url: a.url });
}

function toStoredBlocks(blocks: MessageBlock[]): StoredBlock[] {
  return blocks.map((b) => ({
    id: b.id,
    text: b.text,
    attachments: b.attachments.map(({ id, name, mime, size, kind, asVoice }) => ({ id, name, mime, size, kind, asVoice })),
  }));
}

export function isBlankDraft(message: MessageDraft) {
  return message.blocks.every((b) => !b.text.trim() && b.attachments.length === 0);
}

/** Entrega todos os blocos para um destinatário (a personalização é feita aqui). */
async function deliverBlocks(to: string, contactName: string | undefined, blocks: BlockPayload[], fallback: string) {
  const usable = blocks.filter((b) => b.text.trim() || b.attachments.length > 0);
  for (let i = 0; i < usable.length; i++) {
    const b = usable[i];
    await api("/api/send", {
      method: "POST",
      body: JSON.stringify({ to, text: personalize(b.text, contactName, fallback), attachments: b.attachments }),
    });
    if (i < usable.length - 1) await sleep(BLOCK_GAP_MS[0] + Math.random() * (BLOCK_GAP_MS[1] - BLOCK_GAP_MS[0]));
  }
}

/** Envia a mensagem completa para um único número (teste). */
export async function sendOne(to: string, message: MessageDraft, contactName?: string, fallback = "") {
  await deliverBlocks(to, contactName, toPayload(message.blocks), fallback);
}

export function createCampaign(input: {
  name: string;
  message: MessageDraft;
  selection: SelectionItem[];
  settings: CampaignSettings;
  scheduledFor?: Date | null;
}): Campaign {
  const recipients = resolveRecipients(input.selection, getAudiences()).map((r) => ({ ...r, status: "pending" as const }));
  if (recipients.length === 0) throw new Error("A seleção não contém nenhum destinatário.");
  if (isBlankDraft(input.message)) throw new Error("Escreva uma mensagem ou anexe um arquivo.");
  // O campo de data tem precisão de minuto: aceita o minuto atual (dispara imediatamente) e rejeita o passado.
  if (input.scheduledFor && input.scheduledFor.getTime() < Date.now() - 60_000) throw new Error("Escolha uma data e hora no futuro.");
  return {
    id: nanoid(10),
    name: input.name.trim() || `Disparo ${(input.scheduledFor ?? new Date()).toLocaleString("pt-BR")}`,
    message: { blocks: toStoredBlocks(input.message.blocks) },
    recipients,
    settings: input.settings,
    status: input.scheduledFor ? "scheduled" : "queued",
    createdAt: new Date().toISOString(),
    scheduledFor: input.scheduledFor ? input.scheduledFor.toISOString() : undefined,
    sources: input.selection.map((s) => ({ type: s.type, id: s.id, name: s.name })),
  };
}

function runCampaign(campaign: Campaign, blocks: BlockPayload[]) {
  if (running.has(campaign.id)) return;
  const run: Run = { cancel: false };
  running.set(campaign.id, run);
  notify();

  void (async () => {
    campaign.status = "running";
    campaign.startedAt = new Date().toISOString();
    upsertCampaign(campaign);
    const fallback = campaign.settings.nameFallback || "";

    const pending = campaign.recipients.filter((r) => r.status === "pending");
    for (let i = 0; i < pending.length; i++) {
      if (run.cancel) break;
      const recipient = pending[i];
      recipient.status = "sending";
      upsertCampaign(campaign);
      try {
        await deliverBlocks(recipient.id, recipient.type === "contact" ? recipient.name : undefined, blocks, fallback);
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
    void idbDelete(campaign.id).catch(() => null);
    discardBlobs(blocks);
    notify();
  })();
}

/** Inicia agora. */
export function startCampaign(campaign: Campaign, message: MessageDraft) {
  runCampaign(campaign, toPayload(message.blocks));
}

/** Guarda os anexos no navegador e arma o disparo para o horário programado. */
export async function scheduleCampaign(campaign: Campaign, message: MessageDraft) {
  if (!campaign.scheduledFor) throw new Error("Campanha sem horário programado.");
  await idbPut(campaign.id, toPayload(message.blocks));
  upsertCampaign(campaign);
  armTimer(campaign.id, new Date(campaign.scheduledFor).getTime());
}

function armTimer(id: string, at: number) {
  clearTimer(id);
  const tick = () => {
    const c = getCampaigns().find((x) => x.id === id);
    if (!c || c.status !== "scheduled") return clearTimer(id);
    const remaining = at - Date.now();
    if (remaining > 0) {
      timers.set(id, setTimeout(tick, Math.min(remaining, 30_000)));
      return;
    }
    clearTimer(id);
    void fireScheduled(c);
  };
  tick();
}

function clearTimer(id: string) {
  const t = timers.get(id);
  if (t) clearTimeout(t);
  timers.delete(id);
}

async function fireScheduled(campaign: Campaign) {
  let blocks: BlockPayload[] | undefined;
  try {
    blocks = await idbGet<BlockPayload[]>(campaign.id);
  } catch {
    blocks = undefined;
  }
  if (!blocks) {
    for (const r of campaign.recipients) if (r.status === "pending") r.status = "cancelled";
    campaign.status = "cancelled";
    campaign.note = "Anexos não encontrados neste navegador (o agendamento precisa ser feito e disparado no mesmo navegador).";
    campaign.finishedAt = new Date().toISOString();
    upsertCampaign(campaign);
    return;
  }
  runCampaign(campaign, blocks);
}

/** Cancela uma campanha em execução ou agendada. */
export function cancelCampaign(id: string) {
  const run = running.get(id);
  if (run) {
    run.cancel = true;
    return true;
  }
  const c = getCampaigns().find((x) => x.id === id);
  if (c && c.status === "scheduled") {
    clearTimer(id);
    for (const r of c.recipients) if (r.status === "pending") r.status = "cancelled";
    c.status = "cancelled";
    c.note = "Agendamento cancelado.";
    c.finishedAt = new Date().toISOString();
    upsertCampaign(c);
    void idbGet<BlockPayload[]>(id)
      .then((blocks) => blocks && discardBlobs(blocks))
      .catch(() => null)
      .finally(() => void idbDelete(id).catch(() => null));
    return true;
  }
  return false;
}

/** Ao abrir o app: rearma agendamentos pendentes. Chamar uma vez. */
export function resumeScheduled() {
  for (const c of getCampaigns()) {
    if (c.status !== "scheduled" || !c.scheduledFor) continue;
    const at = new Date(c.scheduledFor).getTime();
    if (Date.now() - at > LATE_TOLERANCE_MS) {
      for (const r of c.recipients) if (r.status === "pending") r.status = "cancelled";
      c.status = "cancelled";
      c.note = `Horário perdido: a aba do app não estava aberta às ${new Date(at).toLocaleString("pt-BR")}.`;
      c.finishedAt = new Date().toISOString();
      upsertCampaign(c);
      void idbGet<BlockPayload[]>(c.id)
        .then((blocks) => blocks && discardBlobs(blocks))
        .catch(() => null)
        .finally(() => void idbDelete(c.id).catch(() => null));
      continue;
    }
    armTimer(c.id, at);
  }
}

/** Aviso ao fechar a aba durante um disparo ou com agendamento pendente. */
if (typeof window !== "undefined") {
  window.addEventListener("beforeunload", (e) => {
    const scheduled = getCampaigns().some((c) => c.status === "scheduled");
    if (running.size > 0 || scheduled) {
      e.preventDefault();
      e.returnValue = "";
    }
  });
}
