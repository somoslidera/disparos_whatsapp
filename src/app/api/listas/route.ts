import { createHash } from "node:crypto";
import { z } from "zod";
import { fail, getCreds, handle, ok } from "@/lib/api";
import { deleteJsonFile, jsonStoreAvailable, listJsonFiles, putJsonFile, readJsonDoc, readJsonFileStrict } from "@/lib/server-json";
import type { Audience } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Listas compartilhadas entre computadores. Ficam no servidor, vinculadas ao servidor do uazapi
 * (hash da URL): qualquer navegador configurado com o mesmo servidor vê as mesmas listas, mesmo que o
 * token seja trocado. Cada lista é um arquivo próprio (listas/<chave>/a/<id>.json), gravado por substituição.
 *
 * Proteções:
 * - leitura que falha vira erro (nunca "nenhuma lista"), para o navegador não apagar a cópia local;
 * - se a chave atual estiver vazia, recupera as listas gravadas sob chaves anteriores (URL + token antigos).
 */

const memberSchema = z.object({ type: z.enum(["contact", "group", "audience"]), id: z.string().min(1).max(200), name: z.string().max(300).default("") });
const ruleSchema = z.object({ id: z.string().min(1).max(40), target: z.enum(["group", "contact"]), op: z.enum(["startsWith", "endsWith", "contains"]), value: z.string().max(100) });
const audienceSchema = z.object({
  id: z.string().regex(/^[A-Za-z0-9_-]{1,40}$/),
  name: z.string().trim().min(1).max(120),
  description: z.string().max(500).optional(),
  color: z.string().max(30).default("emerald"),
  members: z.array(memberSchema).max(5000),
  rules: z.array(ruleSchema).max(20).optional(),
  excludeIds: z.array(z.string().max(200)).max(10000).optional(),
  createdAt: z.string().max(40),
  updatedAt: z.string().max(40),
});

const bodySchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("upsert"), audience: audienceSchema }),
  z.object({ op: z.literal("delete"), id: z.string().regex(/^[A-Za-z0-9_-]{1,40}$/) }),
  z.object({ op: z.literal("import"), audiences: z.array(audienceSchema).max(500) }),
]);

function normUrl(url: string) {
  return url.trim().replace(/\/+$/, "").toLowerCase();
}

/** Chave atual: só a URL do servidor do uazapi (trocar o token não troca as listas). */
function instanceKey(req: Request): string | null {
  const { url, token } = getCreds(req);
  if (!url || !token) return null;
  return createHash("sha256").update(`listas-v2:${normUrl(url)}`).digest("hex").slice(0, 32);
}

const dirOf = (key: string) => `listas/${key}/a/`;
const fileOf = (key: string, id: string) => `${dirOf(key)}${id}.json`;

/** Formato anterior (um único arquivo com todas as listas): migrado na primeira leitura. */
async function migrateLegacy(req: Request, key: string): Promise<void> {
  const legacy = await readJsonDoc<{ audiences?: Audience[] }>(req, `listas/${key}/listas.json`);
  const items = legacy?.value.audiences || [];
  if (!items.length) return;
  const existing = new Set((await listJsonFiles(req, dirOf(key))).map((p) => p.slice(dirOf(key).length).replace(/\.json$/, "")));
  await Promise.all(items.filter((a) => !existing.has(a.id)).map((a) => putJsonFile(req, fileOf(key, a.id), a)));
  await deleteJsonFile(req, `listas/${key}/listas.json`).catch(() => null);
}

async function readAll(req: Request, key: string): Promise<Audience[]> {
  const paths = (await listJsonFiles(req, dirOf(key))).filter((p) => p.endsWith(".json"));
  // Leitura estrita: se algum arquivo não puder ser lido, a chamada falha (o navegador mantém o que tem).
  const items = await Promise.all(paths.map((p) => readJsonFileStrict<Audience>(req, p)));
  return items.filter((a): a is Audience => Boolean(a && a.id)).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

/**
 * Chave atual vazia: procura listas gravadas sob outras chaves (formato antigo URL + token, token trocado,
 * arquivo único antigo) e copia para a chave atual, ficando com a versão mais recente de cada lista.
 */
async function recoverFromOtherKeys(req: Request, key: string): Promise<number> {
  const all = await listJsonFiles(req, "listas/");
  const found = new Map<string, Audience>();
  const consider = (a: Audience | null | undefined) => {
    if (!a || !a.id || !a.name) return;
    const cur = found.get(a.id);
    if (!cur || (a.updatedAt || "") > (cur.updatedAt || "")) found.set(a.id, a);
  };
  for (const p of all) {
    if (p.startsWith(dirOf(key))) continue;
    if (/^listas\/[^/]+\/a\/[^/]+\.json$/.test(p)) consider(await readJsonFileStrict<Audience>(req, p));
    else if (/^listas\/[^/]+\/listas\.json$/.test(p)) (await readJsonFileStrict<{ audiences?: Audience[] }>(req, p))?.audiences?.forEach(consider);
  }
  await Promise.all([...found.values()].map((a) => putJsonFile(req, fileOf(key, a.id), a)));
  if (found.size) console.info("[listas] recuperadas", found.size, "listas gravadas sob chaves anteriores");
  return found.size;
}

async function loadAll(req: Request, key: string): Promise<Audience[]> {
  await migrateLegacy(req, key);
  let items = await readAll(req, key);
  if (items.length === 0 && (await recoverFromOtherKeys(req, key)) > 0) items = await readAll(req, key);
  return items;
}

export const GET = handle(async (req: Request) => {
  if (!jsonStoreAvailable(req)) return fail("Armazenamento do servidor indisponível.", 501);
  const key = instanceKey(req);
  if (!key) return fail("Configure o uazapi na tela Conexão.", 428);
  try {
    return ok({ audiences: await loadAll(req, key) });
  } catch (err) {
    console.error("[listas] falha ao ler:", (err as Error).message);
    return fail(`Não foi possível ler as listas no servidor agora (${(err as Error).message}). Nada foi apagado; tente de novo em instantes.`, 503);
  }
});

export const POST = handle(async (req: Request) => {
  if (!jsonStoreAvailable(req)) return fail("Armazenamento do servidor indisponível.", 501);
  const key = instanceKey(req);
  if (!key) return fail("Configure o uazapi na tela Conexão.", 428);
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    console.warn("[listas] corpo inválido:", issue?.path?.join("."), issue?.message);
    return fail(`Dados inválidos: ${issue?.path?.join(".") || ""} ${issue?.message || ""}`.trim());
  }
  const body = parsed.data;

  try {
    await loadAll(req, key);
    if (body.op === "upsert") {
      const a = body.audience as Audience;
      await putJsonFile(req, fileOf(key, a.id), a);
      // A listagem pode demorar um instante para refletir a gravação: garante a versão nova na resposta
      const all = (await readAll(req, key)).filter((x) => x.id !== a.id);
      return ok({ audiences: [a, ...all] });
    }
    if (body.op === "delete") {
      await deleteJsonFile(req, fileOf(key, body.id)).catch(() => null);
      const all = (await readAll(req, key)).filter((x) => x.id !== body.id);
      // Remove referências à lista excluída em outras listas
      await Promise.all(
        all
          .filter((x) => x.members.some((m) => m.type === "audience" && m.id === body.id))
          .map((x) => {
            x.members = x.members.filter((m) => !(m.type === "audience" && m.id === body.id));
            return putJsonFile(req, fileOf(key, x.id), x);
          }),
      );
      return ok({ audiences: all });
    }
    const current = await readAll(req, key);
    const ids = new Set(current.map((x) => x.id));
    const fresh = (body.audiences as Audience[]).filter((a) => !ids.has(a.id));
    await Promise.all(fresh.map((a) => putJsonFile(req, fileOf(key, a.id), a)));
    return ok({ audiences: [...current, ...fresh] });
  } catch (err) {
    console.error("[listas] falha ao gravar:", (err as Error).message);
    return fail(`Falha ao gravar no servidor: ${(err as Error).message}`, 502);
  }
});
