import { del, get, list, put } from "@vercel/blob";
import { nanoid } from "nanoid";
import { blobAuth, blobMode } from "./blob-auth";

/**
 * Armazenamento dos envios do agente no Vercel Blob (arquivos privados):
 * - agente/ref/<referencia>.json  → trava de referência única (criado sem sobrescrita = atômico) e resultado final
 * - agente/log/<data>-<id>.json   → histórico de todas as chamadas (sucesso, falha, duplicado, teste)
 * - agente/rate/<ms>-<id>         → marcadores para o limite de chamadas por hora
 */

export type AgentStatus = "enviando" | "concluido" | "parcial" | "falha" | "duplicado" | "teste" | "teste_falha";

export interface AgentMessageResult {
  bloco: number;
  id?: string;
  status: string;
  erro?: string;
}

export interface AgentRecord {
  id: string;
  tipo: "agente";
  data: string; // ISO UTC
  referencia: string;
  grupo: string;
  grupoId: string;
  teste: boolean;
  blocos: number;
  textos: string[];
  status: AgentStatus;
  enviados: number;
  mensagens: AgentMessageResult[];
  erro?: string;
  /** Preenchido em registros "duplicado": o resultado anterior que bloqueou o reenvio */
  anterior?: Pick<AgentRecord, "id" | "data" | "status" | "enviados" | "mensagens">;
}

const REF_PREFIX = "agente/ref/";
const LOG_PREFIX = "agente/log/";
const RATE_PREFIX = "agente/rate/";
const STALE_INFLIGHT_MS = 15 * 60 * 1000;

/** Modo de teste local (sem Blob): guarda tudo em memória quando AGENT_STORE_MEMORY=1. */
const memoryMode = () => process.env.AGENT_STORE_MEMORY === "1";
const memory = new Map<string, { value: string; uploadedAt: Date }>();

function safeRef(referencia: string): string {
  return referencia.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 150);
}

async function readJson<T>(req: Request, pathname: string): Promise<T | null> {
  if (memoryMode()) {
    const hit = memory.get(pathname);
    return hit ? (JSON.parse(hit.value) as T) : null;
  }
  const res = await get(pathname, { access: "private", useCache: false, ...blobAuth(req) }).catch(() => null);
  if (!res || !("stream" in res) || !res.stream) return null;
  const text = await new Response(res.stream).text();
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

async function writeJson(req: Request, pathname: string, value: unknown, allowOverwrite: boolean) {
  if (memoryMode()) {
    if (!allowOverwrite && memory.has(pathname)) throw new Error("already exists");
    memory.set(pathname, { value: JSON.stringify(value), uploadedAt: new Date() });
    return;
  }
  await put(pathname, JSON.stringify(value), {
    access: "private",
    contentType: "application/json",
    addRandomSuffix: false,
    allowOverwrite,
    ...blobAuth(req),
  });
}

export function storeAvailable(req: Request): boolean {
  return memoryMode() || blobMode(req) !== "none";
}

/**
 * Tenta reservar a referência. Retorna { claimed: true } quando esta chamada é a dona da referência,
 * ou { claimed: false, existing } quando já há um envio concluído ou em andamento.
 */
export async function claimReference(req: Request, referencia: string, draft: AgentRecord): Promise<{ claimed: true } | { claimed: false; existing: AgentRecord }> {
  const pathname = `${REF_PREFIX}${safeRef(referencia)}.json`;
  try {
    await writeJson(req, pathname, draft, false);
    return { claimed: true };
  } catch (err) {
    const existing = await readJson<AgentRecord>(req, pathname);
    if (!existing) throw err;
    const concluded = existing.status === "concluido" || existing.status === "parcial";
    const inflightFresh = existing.status === "enviando" && Date.now() - new Date(existing.data).getTime() < STALE_INFLIGHT_MS;
    if (concluded || inflightFresh) return { claimed: false, existing };
    // Falha anterior ou envio abandonado: permite nova tentativa, sobrescrevendo a reserva.
    await writeJson(req, pathname, draft, true);
    return { claimed: true };
  }
}

export async function finishReference(req: Request, referencia: string, record: AgentRecord) {
  await writeJson(req, `${REF_PREFIX}${safeRef(referencia)}.json`, record, true);
}

export async function releaseReference(req: Request, referencia: string) {
  const pathname = `${REF_PREFIX}${safeRef(referencia)}.json`;
  if (memoryMode()) {
    memory.delete(pathname);
    return;
  }
  await del(pathname, blobAuth(req)).catch(() => null);
}

export async function appendLog(req: Request, record: AgentRecord) {
  const stamp = record.data.replace(/[:.]/g, "-");
  await writeJson(req, `${LOG_PREFIX}${stamp}-${record.id}.json`, record, true);
}

/** Últimos registros do histórico do agente, mais recentes primeiro. */
export async function listLog(req: Request, limit = 100): Promise<AgentRecord[]> {
  if (memoryMode()) {
    return [...memory.entries()]
      .filter(([k]) => k.startsWith(LOG_PREFIX))
      .sort((a, b) => (a[0] < b[0] ? 1 : -1))
      .slice(0, limit)
      .map(([, v]) => JSON.parse(v.value) as AgentRecord);
  }
  const auth = blobAuth(req);
  const blobs: { pathname: string; uploadedAt: Date }[] = [];
  let cursor: string | undefined;
  do {
    const page = await list({ prefix: LOG_PREFIX, limit: 1000, cursor, ...auth });
    blobs.push(...page.blobs);
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  // Nomes começam pela data ISO, então a ordem alfabética invertida é a cronológica invertida.
  blobs.sort((a, b) => (a.pathname < b.pathname ? 1 : -1));
  const chosen = blobs.slice(0, limit);
  const records = await Promise.all(chosen.map((b) => readJson<AgentRecord>(req, b.pathname)));
  return records.filter((r): r is AgentRecord => Boolean(r));
}

/** Limite simples: no máximo `max` chamadas na última hora. Registra a chamada atual quando permitida. */
export async function checkRateLimit(req: Request, max: number): Promise<{ allowed: boolean; count: number }> {
  if (memoryMode()) {
    const cutoff = Date.now() - 60 * 60 * 1000;
    const recent = [...memory.entries()].filter(([k, v]) => k.startsWith(RATE_PREFIX) && v.uploadedAt.getTime() >= cutoff);
    if (recent.length >= max) return { allowed: false, count: recent.length };
    memory.set(`${RATE_PREFIX}${Date.now()}-${nanoid(6)}`, { value: "1", uploadedAt: new Date() });
    return { allowed: true, count: recent.length + 1 };
  }
  const auth = blobAuth(req);
  const page = await list({ prefix: RATE_PREFIX, limit: 1000, ...auth });
  const cutoff = Date.now() - 60 * 60 * 1000;
  const recent = page.blobs.filter((b) => new Date(b.uploadedAt).getTime() >= cutoff);
  const old = page.blobs.filter((b) => new Date(b.uploadedAt).getTime() < cutoff).map((b) => b.url);
  if (old.length) await del(old, auth).catch(() => null);
  if (recent.length >= max) return { allowed: false, count: recent.length };
  await put(`${RATE_PREFIX}${Date.now()}-${nanoid(6)}`, "1", { access: "private", addRandomSuffix: false, allowOverwrite: true, ...auth }).catch(() => null);
  return { allowed: true, count: recent.length + 1 };
}

export function newRecordId() {
  return nanoid(10);
}
