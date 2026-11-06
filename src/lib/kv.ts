import { createHash } from "node:crypto";

/**
 * Banco Redis (Upstash) acessado pela API REST, sem dependências extras.
 * Usado para guardar o estado do app (marcações de lançamentos, referências de envio,
 * histórico do agente, limite por hora e listas) no lugar do Vercel Blob.
 *
 * O Blob no plano Hobby tem poucas "operações avançadas" (put/list) por mês e o store é
 * suspenso quando o limite estoura. O Upstash gratuito aguenta muito mais comandos.
 *
 * Variáveis aceitas (criadas automaticamente ao conectar o Upstash pela Vercel):
 * - KV_REST_API_URL + KV_REST_API_TOKEN
 * - UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN
 * Sem elas, o app continua usando o Blob como antes.
 */

type RedisValue = string | number | null | RedisValue[];

function kvCreds(): { url: string; token: string } | null {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  return { url: url.replace(/\/+$/, ""), token };
}

export function kvAvailable(): boolean {
  return kvCreds() !== null;
}

/** Executa um comando. Ex.: kv(["SET", "chave", "valor", "NX"]). */
export async function kv<T = RedisValue>(command: (string | number)[]): Promise<T> {
  const creds = kvCreds();
  if (!creds) throw new Error("Banco Redis (Upstash) não configurado.");
  const res = await fetch(creds.url, {
    method: "POST",
    headers: { Authorization: `Bearer ${creds.token}`, "Content-Type": "application/json" },
    body: JSON.stringify(command.map(String)),
    cache: "no-store",
  });
  const data = (await res.json().catch(() => null)) as { result?: T; error?: string } | null;
  if (!res.ok || !data || data.error) throw new Error(`Redis: ${data?.error || res.statusText || res.status}`);
  return data.result as T;
}

/** Vários comandos numa ida só (pipeline). Devolve o resultado de cada um, na ordem. */
export async function kvPipeline<T = RedisValue>(commands: (string | number)[][]): Promise<T[]> {
  if (!commands.length) return [];
  const creds = kvCreds();
  if (!creds) throw new Error("Banco Redis (Upstash) não configurado.");
  const res = await fetch(`${creds.url}/pipeline`, {
    method: "POST",
    headers: { Authorization: `Bearer ${creds.token}`, "Content-Type": "application/json" },
    body: JSON.stringify(commands.map((c) => c.map(String))),
    cache: "no-store",
  });
  const data = (await res.json().catch(() => null)) as { result?: T; error?: string }[] | { error?: string } | null;
  if (!res.ok || !Array.isArray(data)) throw new Error(`Redis: ${(data as { error?: string } | null)?.error || res.statusText || res.status}`);
  return data.map((d) => {
    if (d.error) throw new Error(`Redis: ${d.error}`);
    return d.result as T;
  });
}

/** Lista as chaves que começam com `prefix` (SCAN, sem travar o banco). */
export async function kvKeys(prefix: string): Promise<string[]> {
  const out: string[] = [];
  let cursor = "0";
  const pattern = `${prefix.replace(/([*?[\]\\])/g, "\\$1")}*`;
  do {
    const [next, keys] = await kv<[string, string[]]>(["SCAN", cursor, "MATCH", pattern, "COUNT", 1000]);
    out.push(...keys);
    cursor = String(next);
  } while (String(cursor) !== "0");
  return out;
}

/** ETag do conteúdo: sha1 do texto, igual ao redis.sha1hex usado no script de gravação condicional. */
export function kvEtag(text: string): string {
  return createHash("sha1").update(text).digest("hex");
}

/**
 * Grava só se o conteúdo atual tiver o ETag informado (ou, com etag vazio, só se a chave não existir).
 * Devolve true quando gravou.
 */
const CAS_SCRIPT = `
local cur = redis.call('GET', KEYS[1])
if ARGV[2] == '' then
  if cur then return 0 end
else
  if (not cur) or redis.sha1hex(cur) ~= ARGV[2] then return 0 end
end
redis.call('SET', KEYS[1], ARGV[1])
return 1`;

export async function kvCompareAndSet(key: string, value: string, etag: string | null): Promise<boolean> {
  const r = await kv<number>(["EVAL", CAS_SCRIPT, 1, key, value, etag || ""]);
  return Number(r) === 1;
}
