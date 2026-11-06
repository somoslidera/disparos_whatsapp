import { BlobNotFoundError, del, get, list, put } from "@vercel/blob";
import { blobAuth, blobMode } from "./blob-auth";
import { kv, kvAvailable, kvCompareAndSet, kvEtag, kvKeys, kvPipeline } from "./kv";

/**
 * Leitura/escrita de documentos JSON no Vercel Blob (store público do projeto), com controle
 * de concorrência por ETag. Em testes locais (AGENT_STORE_MEMORY=1) usa memória.
 */

const memoryMode = () => process.env.AGENT_STORE_MEMORY === "1";
const g = globalThis as unknown as { __jsonMemory?: Map<string, { value: string; etag: string }> };
const memory = g.__jsonMemory ?? new Map<string, { value: string; etag: string }>();
g.__jsonMemory = memory;

export function jsonStoreAvailable(req: Request): boolean {
  return memoryMode() || kvAvailable() || blobMode(req) !== "none";
}

/**
 * Com o Redis (Upstash) configurado, os documentos ficam lá. O Blob vira só fonte antiga de leitura:
 * um documento que ainda não está no Redis é copiado do Blob na primeira leitura. Itens apagados
 * ganham uma marca ("tomb") para não voltarem pela cópia do Blob.
 */
const kvOn = () => !memoryMode() && kvAvailable();
const KV_NS = "disparos:";
const TOMB = `${KV_NS}json-apagados`;

async function blobReadText(req: Request, pathname: string): Promise<string | null> {
  if (blobMode(req) === "none") return null;
  const res = await get(pathname, { access: "public", useCache: false, ...blobAuth(req) }).catch(() => null);
  if (!res || res.statusCode !== 200 || !res.stream) return null;
  return new Response(res.stream).text().catch(() => null);
}

async function kvRead(req: Request, pathname: string): Promise<string | null> {
  const [text, tomb] = await kvPipeline<string | number | null>([
    ["GET", KV_NS + pathname],
    ["SISMEMBER", TOMB, pathname],
  ]);
  if (typeof text === "string") return text;
  if (Number(tomb) === 1) return null;
  const old = await blobReadText(req, pathname);
  if (old === null) return null;
  await kv(["SET", KV_NS + pathname, old, "NX"]);
  return (await kv<string | null>(["GET", KV_NS + pathname])) ?? old;
}

export async function readJsonDoc<T>(req: Request, pathname: string): Promise<{ value: T; etag: string } | null> {
  if (memoryMode()) {
    const hit = memory.get(pathname);
    return hit ? { value: JSON.parse(hit.value) as T, etag: hit.etag } : null;
  }
  if (kvOn()) {
    const text = await kvRead(req, pathname);
    if (text === null) return null;
    try {
      return { value: JSON.parse(text) as T, etag: kvEtag(text) };
    } catch {
      return null;
    }
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
  if (kvOn()) {
    const okWrite = await kvCompareAndSet(KV_NS + pathname, body, etag);
    if (!okWrite) throw new Error("conflict");
    await kv(["SREM", TOMB, pathname]);
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
  if (kvOn()) {
    await kvPipeline([
      ["SET", KV_NS + pathname, body],
      ["SREM", TOMB, pathname],
    ]);
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

/**
 * Como readJsonFile, mas distingue "não existe" (null) de "não deu para ler" (lança erro).
 * Use quando uma falha de leitura não pode ser confundida com ausência de dados.
 */
export async function readJsonFileStrict<T>(req: Request, pathname: string): Promise<T | null> {
  if (memoryMode()) {
    const hit = memory.get(pathname);
    return hit ? (JSON.parse(hit.value) as T) : null;
  }
  if (kvOn()) {
    // Erro do Redis lança; o Blob antigo (se estiver fora do ar) só deixa de completar.
    const text = await kvRead(req, pathname);
    return text === null ? null : (JSON.parse(text) as T);
  }
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await get(pathname, { access: "public", useCache: false, ...blobAuth(req) });
      if (!res) return null;
      if (res.statusCode !== 200 || !res.stream) throw new Error(`leitura de ${pathname} respondeu ${res.statusCode}`);
      const text = await new Response(res.stream).text();
      return JSON.parse(text) as T;
    } catch (err) {
      if (err instanceof BlobNotFoundError) return null;
      lastErr = err;
      await new Promise((r) => setTimeout(r, 200 * (attempt + 1)));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(`Falha ao ler ${pathname}`);
}

export async function readJsonFile<T>(req: Request, pathname: string): Promise<T | null> {
  const doc = await readJsonDoc<T>(req, pathname);
  return doc ? doc.value : null;
}

/** Lista os caminhos sob um prefixo. */
export async function listJsonFiles(req: Request, prefix: string): Promise<string[]> {
  if (memoryMode()) return [...memory.keys()].filter((k) => k.startsWith(prefix));
  if (kvOn()) {
    const fromKv = (await kvKeys(KV_NS + prefix)).map((k) => k.slice(KV_NS.length));
    const fromBlob = blobMode(req) === "none" ? [] : await listBlobNames(req, prefix).catch(() => []);
    const tomb = new Set(await kv<string[]>(["SMEMBERS", TOMB]));
    return [...new Set([...fromKv, ...fromBlob])].filter((p) => !tomb.has(p));
  }
  return listBlobNames(req, prefix);
}

async function listBlobNames(req: Request, prefix: string): Promise<string[]> {
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
  if (kvOn()) {
    await kvPipeline([
      ["DEL", KV_NS + pathname],
      ["SADD", TOMB, pathname],
    ]);
    if (blobMode(req) !== "none") await del(pathname, blobAuth(req)).catch(() => null);
    return;
  }
  await del(pathname, blobAuth(req));
}
