"use client";

import { nanoid } from "nanoid";
import type { Audience, Campaign, StoredMessage } from "./types";

/**
 * Persistência no navegador (localStorage): listas e histórico de campanhas.
 * O servidor não guarda nada; tudo fica no dispositivo do usuário.
 */

const KEY_AUDIENCES = "disparos:audiences";
const KEY_CAMPAIGNS = "disparos:campaigns";
const MAX_CAMPAIGNS = 200;

type Listener = () => void;
const listeners = new Set<Listener>();

let audiences: Audience[] | null = null;
let campaigns: Campaign[] | null = null;

function load<T>(key: string): T[] {
  try {
    const raw = typeof window !== "undefined" ? localStorage.getItem(key) : null;
    const parsed = raw ? (JSON.parse(raw) as T[]) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function persist(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (err) {
    console.error("Falha ao salvar no navegador", err);
  }
}

function emit() {
  listeners.forEach((l) => l());
}

export function subscribe(l: Listener) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

const EMPTY_AUDIENCES: Audience[] = [];
const EMPTY_CAMPAIGNS: Campaign[] = [];

/** Snapshots estáveis para a renderização no servidor e hidratação (evita divergência de HTML). */
export const getServerAudiences = () => EMPTY_AUDIENCES;
export const getServerCampaigns = () => EMPTY_CAMPAIGNS;

export function getAudiences(): Audience[] {
  if (typeof window === "undefined") return EMPTY_AUDIENCES;
  if (!audiences) audiences = load<Audience>(KEY_AUDIENCES);
  return audiences;
}

/** Converte campanhas salvas no formato antigo (mensagem única) para blocos. */
function normalizeMessage(raw: unknown): StoredMessage {
  const m = (raw || {}) as { blocks?: StoredMessage["blocks"]; text?: string; attachments?: StoredMessage["blocks"][number]["attachments"] };
  if (Array.isArray(m.blocks)) return { blocks: m.blocks };
  return { blocks: [{ id: "b1", text: m.text || "", attachments: Array.isArray(m.attachments) ? m.attachments : [] }] };
}

export function getCampaigns(): Campaign[] {
  if (typeof window === "undefined") return EMPTY_CAMPAIGNS;
  if (!campaigns) {
    campaigns = load<Campaign>(KEY_CAMPAIGNS);
    // Campanhas interrompidas por recarregamento da página + migração de formato
    let changed = false;
    for (const c of campaigns) {
      const msg = c.message as unknown as { blocks?: unknown };
      if (!Array.isArray(msg?.blocks)) {
        c.message = normalizeMessage(c.message);
        changed = true;
      }
      if (c.status === "running" || c.status === "queued") {
        for (const r of c.recipients) if (r.status === "pending" || r.status === "sending") r.status = "cancelled";
        c.status = "cancelled";
        c.finishedAt = c.finishedAt ?? new Date().toISOString();
        changed = true;
      }
    }
    if (changed) persist(KEY_CAMPAIGNS, campaigns);
  }
  return campaigns;
}

export function saveAudience(input: Omit<Audience, "id" | "createdAt" | "updatedAt"> & { id?: string }): Audience {
  const list = getAudiences();
  const now = new Date().toISOString();
  let saved: Audience;
  if (input.id) {
    const idx = list.findIndex((a) => a.id === input.id);
    if (idx < 0) throw new Error("Lista não encontrada");
    saved = { ...list[idx], ...input, id: input.id, updatedAt: now };
    audiences = list.map((a, i) => (i === idx ? saved : a));
  } else {
    saved = { ...input, id: nanoid(10), createdAt: now, updatedAt: now };
    audiences = [saved, ...list];
  }
  persist(KEY_AUDIENCES, audiences);
  emit();
  return saved;
}

export function deleteAudience(id: string) {
  audiences = getAudiences()
    .filter((a) => a.id !== id)
    .map((a) => ({ ...a, members: a.members.filter((m) => !(m.type === "audience" && m.id === id)) }));
  persist(KEY_AUDIENCES, audiences);
  emit();
}

export function upsertCampaign(c: Campaign) {
  const list = getCampaigns();
  const idx = list.findIndex((x) => x.id === c.id);
  const copy = { ...c, recipients: c.recipients.map((r) => ({ ...r })) };
  campaigns = idx >= 0 ? list.map((x, i) => (i === idx ? copy : x)) : [copy, ...list].slice(0, MAX_CAMPAIGNS);
  persist(KEY_CAMPAIGNS, campaigns);
  emit();
}

export function deleteCampaign(id: string) {
  campaigns = getCampaigns().filter((c) => c.id !== id);
  persist(KEY_CAMPAIGNS, campaigns);
  emit();
}

export function getCampaign(id: string): Campaign | undefined {
  return getCampaigns().find((c) => c.id === id);
}
