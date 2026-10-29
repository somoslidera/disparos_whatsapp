import { del, get, list, put } from "@vercel/blob";
import { blobAuth, blobMode } from "./blob-auth";

/**
 * Leitura/escrita de documentos JSON no Vercel Blob (store público do projeto), com controle
 * de concorrência por ETag. Em testes locais (AGENT_STORE_MEMORY=1) usa memória.
 */

const memoryMode = () => process.env.AGENT_STORE_MEMORY === "1";
const g = globalThis as unknown as { __jsonMemory?: Map<string, { value: string; etag: string }> };
const memory = g.__jsonMemory ?? new Map<string, { value: string; etag: string }>();
g.__jsonMemory = memory;

export function jsonStoreAvailable(req: Request): boolean {
  return memoryMode() || blobMode(req) !== "none";
}

export async function readJsonDoc<T>(req: Request, pathname: string): Promise<{ value: T; etag: string } | null> {
  if (memoryMode()) {
    const hit = memory.get(pathname);
    return hit ? { value: JSON.parse(hit.value) as T, etag: hit.etag } : null;
  }
  const res = await get(pathname, { access: "public", useCache: false, ...blobAuth(req) }).catch(() => null);
  if (!res || res.statusCode !== 200 || !res.stream) return null;
  const text = await new Response(res.stream).text();
  try {
    return { value: JSON.parse(text) as T, etag: res.blob.etag };
  } catch {
    return null;
  }
}

/**
 * Grava o documento. Com `etag`, só grava se ninguém alterou desde a leitura; sem `etag`,
 * só cria se ainda não existir. Lança erro em conflito (o chamador relê e tenta de novo).
 */
export async function writeJsonDoc(req: Request, pathname: string, value: unknown, etag: string | null): Promise<void> {
  const body = JSON.stringify(value);
  if (memoryMode()) {
    const cur = memory.get(pathname);
    if (etag ? cur?.etag !== etag : Boolean(cur)) throw new Error("conflict");
    memory.set(pathname, { value: body, etag: `m${Date.now()}${Math.random()}` });
    return;
  }
  await put(pathname, body, {
    access: "public",
    contentType: "application/json",
    addRandomSuffix: false,
    cacheControlMaxAge: 60,
    ...(etag ? { ifMatch: etag } : { allowOverwrite: false }),
    ...blobAuth(req),
  });
}

/** Lê, aplica `mutate` e grava com controle de concorrência, repetindo em caso de conflito. */
export async function updateJsonDoc<T>(req: Request, pathname: string, initial: T, mutate: (cur: T) => T, attempts = 5): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    const cur = await readJsonDoc<T>(req, pathname);
    const next = mutate(cur ? cur.value : structuredClone(initial));
    try {
      await writeJsonDoc(req, pathname, next, cur ? cur.etag : null);
      return next;
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, 150 + Math.random() * 300));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("Não foi possível salvar (conflito de edição).");
}

// ---------------------------------------------------------------------------
// Documentos individuais (um arquivo por item), sem gravação condicional
// ---------------------------------------------------------------------------

/** Grava (ou substitui) um documento JSON. */
export async function putJsonFile(req: Request, pathname: string, value: unknown): Promise<void> {
  const body = JSON.stringify(value);
  if (memoryMode()) {
    memory.set(pathname, { value: body, etag: `m${Date.now()}` });
    return;
  }
  await put(pathname, body, {
    access: "public",
    contentType: "application/json",
    addRandomSuffix: false,
    allowOverwrite: true,
    cacheControlMaxAge: 60,
    ...blobAuth(req),
  });
}

export async function readJsonFile<T>(req: Request, pathname: string): Promise<T | null> {
  const doc = await readJsonDoc<T>(req, pathname);
  return doc ? doc.value : null;
}

/** Lista os caminhos sob um prefixo. */
export async function listJsonFiles(req: Request, prefix: string): Promise<string[]> {
  if (memoryMode()) return [...memory.keys()].filter((k) => k.startsWith(prefix));
  const out: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await list({ prefix, limit: 1000, cursor, ...blobAuth(req) });
    out.push(...page.blobs.map((b) => b.pathname));
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  return out;
}

export async function deleteJsonFile(req: Request, pathname: string): Promise<void> {
  if (memoryMode()) {
    memory.delete(pathname);
    return;
  }
  await del(pathname, blobAuth(req));
}
