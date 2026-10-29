"use client";

import { nanoid } from "nanoid";
import { api } from "./client";
import { getSettings } from "./settings";
import type { Audience, Campaign, StoredMessage } from "./types";

/**
 * Persistência:
 * - Listas: no servidor (compartilhadas entre computadores da mesma instância do uazapi), com cópia
 *   em localStorage para abrir rápido e funcionar se o servidor estiver indisponível.
 * - Histórico de campanhas: apenas no navegador.
 */

const KEY_AUDIENCES = "disparos:audiences";
/** Marca, por instância, que as listas locais já foram enviadas ao servidor uma vez */
const KEY_IMPORTED = "disparos:audiences:imported";
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

// ---------------------------------------------------------------------------
// Listas compartilhadas (servidor)
// ---------------------------------------------------------------------------

export type SyncState = "local" | "syncing" | "synced" | "error";
let syncState: SyncState = "local";
let syncSnapshot: { state: SyncState; error: string | null } = { state: "local", error: null };
let syncing: Promise<void> | null = null;
const SERVER_SYNC = { state: "local" as SyncState, error: null as string | null };

/** Estado da sincronização das listas (snapshot estável para useSyncExternalStore). */
export function getSyncState() {
  return syncSnapshot;
}
export const getServerSyncState = () => SERVER_SYNC;

function setSync(state: SyncState, error: string | null = null) {
  syncState = state;
  if (syncSnapshot.state !== state || syncSnapshot.error !== error) syncSnapshot = { state, error };
  emit();
}

/** Identificador simples da instância configurada (não é segredo; só separa as marcas de importação). */
function instanceTag(): string {
  const st = getSettings();
  const raw = `${(st?.url || "env").trim().toLowerCase()}|${(st?.token || "").trim()}`;
  let h = 5381;
  for (let i = 0; i < raw.length; i++) h = ((h << 5) + h + raw.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

function importedFor(tag: string): boolean {
  try {
    return (localStorage.getItem(KEY_IMPORTED) || "").split(",").includes(tag);
  } catch {
    return false;
  }
}

function markImported(tag: string) {
  try {
    const cur = (localStorage.getItem(KEY_IMPORTED) || "").split(",").filter(Boolean);
    if (!cur.includes(tag)) localStorage.setItem(KEY_IMPORTED, [...cur, tag].join(","));
  } catch {
    /* ignore */
  }
}

function applyServer(list: Audience[]) {
  audiences = list;
  persist(KEY_AUDIENCES, audiences);
}

/**
 * Busca as listas no servidor. Na primeira vez em cada instância, envia as listas que só existem
 * neste navegador; depois disso o servidor é a fonte de verdade (exclusões feitas em outro
 * computador não voltam).
 */
export function syncAudiences(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (syncing) return syncing;
  syncing = (async () => {
    setSync(syncState === "synced" ? "synced" : "syncing");
    try {
      const res = await api<{ audiences: Audience[] }>("/api/listas");
      let server = res.audiences || [];
      const tag = instanceTag();
      if (!importedFor(tag)) {
        const ids = new Set(server.map((a) => a.id));
        const localOnly = getAudiences().filter((a) => !ids.has(a.id));
        if (localOnly.length) {
          server = (await api<{ audiences: Audience[] }>("/api/listas", { method: "POST", body: JSON.stringify({ op: "import", audiences: localOnly }) })).audiences;
        }
        markImported(tag);
      }
      applyServer(server);
      setSync("synced");
    } catch (err) {
      setSync("error", (err as Error).message);
    } finally {
      syncing = null;
    }
  })();
  return syncing;
}

/** Envia a alteração ao servidor. Retorna a mensagem de erro (a alteração continua salva neste navegador). */
async function pushOp(body: unknown): Promise<string | null> {
  try {
    const res = await api<{ audiences: Audience[] }>("/api/listas", { method: "POST", body: JSON.stringify(body) });
    applyServer(res.audiences);
    setSync("synced");
    return null;
  } catch (err) {
    setSync("error", (err as Error).message);
    return `Salvo só neste navegador: não foi possível sincronizar com o servidor (${(err as Error).message}).`;
  }
}

export async function saveAudience(input: Omit<Audience, "id" | "createdAt" | "updatedAt"> & { id?: string }): Promise<{ audience: Audience; syncError: string | null }> {
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
  const syncError = await pushOp({ op: "upsert", audience: saved });
  return { audience: saved, syncError };
}

export async function deleteAudience(id: string): Promise<string | null> {
  audiences = getAudiences()
    .filter((a) => a.id !== id)
    .map((a) => ({ ...a, members: a.members.filter((m) => !(m.type === "audience" && m.id === id)) }));
  persist(KEY_AUDIENCES, audiences);
  emit();
  return pushOp({ op: "delete", id });
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
