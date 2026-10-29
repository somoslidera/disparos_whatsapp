import { createHash } from "node:crypto";
import { z } from "zod";
import { fail, getCreds, handle, ok } from "@/lib/api";
import { jsonStoreAvailable, readJsonDoc, updateJsonDoc } from "@/lib/server-json";
import type { Audience } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * Listas compartilhadas entre computadores. Ficam no servidor, vinculadas à instância do uazapi
 * (hash de URL + token): qualquer navegador configurado com a mesma instância vê as mesmas listas.
 */

interface ListsDoc {
  version: 1;
  updatedAt: string;
  audiences: Audience[];
}

const EMPTY: ListsDoc = { version: 1, updatedAt: new Date(0).toISOString(), audiences: [] };

const memberSchema = z.object({ type: z.enum(["contact", "group", "audience"]), id: z.string().min(1).max(200), name: z.string().max(300).default("") });
const ruleSchema = z.object({ id: z.string().min(1).max(40), target: z.enum(["group", "contact"]), op: z.enum(["startsWith", "endsWith", "contains"]), value: z.string().max(100) });
const audienceSchema = z.object({
  id: z.string().min(1).max(40),
  name: z.string().trim().min(1).max(120),
  description: z.string().max(500).optional(),
  color: z.string().max(30).default("emerald"),
  members: z.array(memberSchema).max(5000),
  rules: z.array(ruleSchema).max(20).optional(),
  excludeIds: z.array(z.string().max(200)).max(5000).optional(),
  createdAt: z.string().max(40),
  updatedAt: z.string().max(40),
});

const bodySchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("upsert"), audience: audienceSchema }),
  z.object({ op: z.literal("delete"), id: z.string().min(1).max(40) }),
  z.object({ op: z.literal("import"), audiences: z.array(audienceSchema).max(500) }),
]);

function docPath(req: Request): string | null {
  const { url, token } = getCreds(req);
  if (!url || !token) return null;
  const key = createHash("sha256").update(`listas:${url.trim().replace(/\/+$/, "").toLowerCase()}:${token.trim()}`).digest("hex").slice(0, 32);
  return `listas/${key}/listas.json`;
}

export const GET = handle(async (req: Request) => {
  if (!jsonStoreAvailable(req)) return fail("Armazenamento do servidor indisponível.", 501);
  const path = docPath(req);
  if (!path) return fail("Configure o uazapi na tela Conexão.", 428);
  const doc = await readJsonDoc<ListsDoc>(req, path);
  return ok({ audiences: doc?.value.audiences ?? [], updatedAt: doc?.value.updatedAt ?? null, exists: Boolean(doc) });
});

export const POST = handle(async (req: Request) => {
  if (!jsonStoreAvailable(req)) return fail("Armazenamento do servidor indisponível.", 501);
  const path = docPath(req);
  if (!path) return fail("Configure o uazapi na tela Conexão.", 428);
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail(parsed.error.issues[0]?.message || "Dados inválidos.");
  const body = parsed.data;

  const doc = await updateJsonDoc<ListsDoc>(req, path, EMPTY, (cur) => {
    let list = [...(cur.audiences || [])];
    if (body.op === "upsert") {
      const a = body.audience as Audience;
      const idx = list.findIndex((x) => x.id === a.id);
      list = idx >= 0 ? list.map((x, i) => (i === idx ? a : x)) : [a, ...list];
    } else if (body.op === "delete") {
      list = list.filter((x) => x.id !== body.id).map((x) => ({ ...x, members: x.members.filter((m) => !(m.type === "audience" && m.id === body.id)) }));
    } else {
      const ids = new Set(list.map((x) => x.id));
      for (const a of body.audiences as Audience[]) if (!ids.has(a.id)) list.push(a);
    }
    return { version: 1, updatedAt: new Date().toISOString(), audiences: list };
  });
  return ok({ audiences: doc.audiences, updatedAt: doc.updatedAt });
});
