import { z } from "zod";
import { listGroups, sendText, type Creds } from "./uazapi";
import type { WaGroup } from "./types";

/** Regras do agente: só grupos cujo nome começa com "PLL |" ou "PLL Flow |". */
export const ALLOWED_GROUP_RE = /^PLL(?: Flow)? \|/i;
export const MAX_BLOCKS = 4;
export const MAX_BLOCK_CHARS = 1000;
export const RATE_LIMIT_PER_HOUR = 30;
/** Mesmo intervalo entre blocos usado pela tela (campaign-client) */
const BLOCK_GAP_MS: [number, number] = [1500, 3000];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const agentSendSchema = z
  .object({
    grupo: z.string().trim().min(1).optional(),
    grupoId: z.string().trim().min(1).optional(),
    blocos: z
      .array(z.string({ message: "Cada bloco precisa ser um texto." }).refine((t) => t.trim().length > 0, "Bloco vazio.").refine((t) => t.length <= MAX_BLOCK_CHARS, `Bloco acima de ${MAX_BLOCK_CHARS} caracteres.`))
      .min(1, "Informe pelo menos 1 bloco.")
      .max(MAX_BLOCKS, `No máximo ${MAX_BLOCKS} blocos.`),
    referencia: z.string({ message: "referencia é obrigatória." }).trim().min(3, "referencia precisa ter pelo menos 3 caracteres.").max(150),
    teste: z.boolean().optional().default(false),
  })
  .refine((v) => v.grupo || v.grupoId, { message: "Informe grupo (nome exato) ou grupoId." });

export type AgentSendInput = z.infer<typeof agentSendSchema>;

export function isAllowedGroup(name: string): boolean {
  return ALLOWED_GROUP_RE.test(name.trim());
}

function norm(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export type GroupResolution =
  | { ok: true; group: WaGroup }
  | { ok: false; status: 422; message: string; parecidos: { nome: string; id: string }[] }
  | { ok: false; status: 403; message: string };

/** Resolve o grupo pelo nome exato (ou id) e aplica a trava de prefixo. */
export async function resolveGroup(creds: Creds, input: { grupo?: string; grupoId?: string }): Promise<GroupResolution> {
  const groups = await listGroups(creds, false);

  if (input.grupoId) {
    const g = groups.find((x) => x.id === input.grupoId!.trim());
    if (!g) return { ok: false, status: 422, message: "grupoId não encontrado entre os grupos da conta.", parecidos: [] };
    if (!isAllowedGroup(g.name)) return { ok: false, status: 403, message: `O grupo "${g.name}" não começa com "PLL |" ou "PLL Flow |".` };
    return { ok: true, group: g };
  }

  const wanted = input.grupo!.trim();
  let matches = groups.filter((g) => g.name.trim() === wanted);
  if (matches.length === 0) matches = groups.filter((g) => norm(g.name) === norm(wanted));

  if (matches.length === 1) {
    const g = matches[0];
    if (!isAllowedGroup(g.name)) return { ok: false, status: 403, message: `O grupo "${g.name}" não começa com "PLL |" ou "PLL Flow |".` };
    return { ok: true, group: g };
  }

  if (matches.length > 1) {
    return { ok: false, status: 422, message: `Mais de um grupo com o nome "${wanted}".`, parecidos: matches.map((g) => ({ nome: g.name, id: g.id })) };
  }

  // Sugestões: grupos permitidos cujo nome contém alguma palavra relevante do nome pedido
  const words = norm(wanted)
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 3 && !["pll", "flow"].includes(w));
  const parecidos = groups
    .filter((g) => isAllowedGroup(g.name))
    .filter((g) => words.some((w) => norm(g.name).includes(w)))
    .slice(0, 10)
    .map((g) => ({ nome: g.name, id: g.id }));
  return { ok: false, status: 422, message: `Nenhum grupo com o nome exato "${wanted}".`, parecidos };
}

export interface BlockSendResult {
  bloco: number;
  id?: string;
  status: string;
  erro?: string;
}

/** Envia os blocos em sequência; para no primeiro erro. */
export async function sendBlocks(creds: Creds, number: string, blocks: string[]): Promise<{ results: BlockSendResult[]; failed: boolean }> {
  const results: BlockSendResult[] = [];
  for (let i = 0; i < blocks.length; i++) {
    try {
      const res = await sendText(creds, number, blocks[i]);
      const raw = (res.raw || {}) as { status?: unknown };
      results.push({ bloco: i + 1, id: res.messageId, status: typeof raw.status === "string" ? raw.status : "enviado" });
    } catch (err) {
      results.push({ bloco: i + 1, status: "falha", erro: (err as Error).message });
      for (let j = i + 1; j < blocks.length; j++) results.push({ bloco: j + 1, status: "nao_enviado" });
      return { results, failed: true };
    }
    if (i < blocks.length - 1) await sleep(BLOCK_GAP_MS[0] + Math.random() * (BLOCK_GAP_MS[1] - BLOCK_GAP_MS[0]));
  }
  return { results, failed: false };
}

/** Data/hora no fuso de São Paulo com offset (ex.: 2026-10-27T10:27:07-03:00). */
export function formatSaoPaulo(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZoneName: "longOffset",
  }).formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value || "";
  const offsetRaw = get("timeZoneName"); // ex.: GMT-03:00
  const offset = offsetRaw.replace("GMT", "") || "-03:00";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}:${get("second")}${offset === "" ? "Z" : offset}`;
}
