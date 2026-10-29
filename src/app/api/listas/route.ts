import { createHash } from "node:crypto";
import { z } from "zod";
import { fail, getCreds, handle, ok } from "@/lib/api";
import { deleteJsonFile, jsonStoreAvailable, listJsonFiles, putJsonFile, readJsonDoc, readJsonFile } from "@/lib/server-json";
import type { Audience } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Listas compartilhadas entre computadores. Ficam no servidor, vinculadas à instância do uazapi
 * (hash de URL + token): qualquer navegador configurado com a mesma instância vê as mesmas listas.
 * Cada lista é um arquivo próprio (listas/<instância>/a/<id>.json), gravado por substituição.
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

function instanceKey(req: Request): string | null {
  const { url, token } = getCreds(req);
  if (!url || !token) return null;
  return createHash("sha256").update(`listas:${url.trim().replace(/\/+$/, "").toLowerCase()}:${token.trim()}`).digest("hex").slice(0, 32);
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
  const paths = await listJsonFiles(req, dirOf(key));
  const items = await Promise.all(paths.filter((p) => p.endsWith(".json")).map((p) => readJsonFile<Audience>(req, p)));
  return items.filter((a): a is Audience => Boolean(a && a.id)).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export const GET = handle(async (req: Request) => {
  if (!jsonStoreAvailable(req)) return fail("Armazenamento do servidor indisponível.", 501);
  const key = instanceKey(req);
  if (!key) return fail("Configure o uazapi na tela Conexão.", 428);
  await migrateLegacy(req, key);
  return ok({ audiences: await readAll(req, key) });
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
  await migrateLegacy(req, key);

  try {
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
