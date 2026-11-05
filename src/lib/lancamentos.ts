import { formatSaoPaulo, isLancamentosGroup } from "./agent";
import { listMarkedIds, noteKey } from "./agent-store";
import { findMessages, listContacts, listGroups, type ChatMessage, type Creds } from "./uazapi";
import { jidToPhone } from "./phone";
import type { WaGroup } from "./types";

/**
 * Notas fiscais nos grupos "Lançamentos - <cliente>": fotos e PDFs enviados pelos clientes
 * que o agente ainda não marcou como lançados ou ignorados.
 */

export const DEFAULT_DAYS = 7;

/**
 * Início dos lançamentos automáticos: nada enviado antes disso entra em /pendentes, mesmo com "desde" anterior.
 * (Decisão de 05/11/2026: começar daqui para frente, sem tratar o que já estava nos grupos.)
 * Pode ser alterado pela variável DISPAROS_LANC_INICIO (data/hora ISO).
 */
const LANC_INICIO_PADRAO = "2026-11-05T10:30:00-03:00";
export function lancamentosStart(): number {
  const fromEnv = Date.parse(process.env.DISPAROS_LANC_INICIO || "");
  return Number.isFinite(fromEnv) ? fromEnv : Date.parse(LANC_INICIO_PADRAO);
}
export const DEFAULT_PER_GROUP = 100;
export const MAX_PER_GROUP = 200;

/** Foto ou documento que pode ser uma NF (PDF ou imagem; documento sem tipo conhecido também entra). */
export function isNoteCandidate(m: ChatMessage): boolean {
  if (m.kind === "imagem") return true;
  if (m.kind !== "documento") return false;
  const mime = (m.mimetype || "").toLowerCase();
  const name = (m.fileName || "").toLowerCase();
  if (mime.includes("pdf") || mime.startsWith("image/")) return true;
  if (/\.(pdf|jpe?g|png|webp|heic)$/.test(name)) return true;
  return !mime; // sem informação: melhor mostrar do que perder uma nota
}

export async function lancamentosGroups(creds: Creds): Promise<WaGroup[]> {
  return (await listGroups(creds, false)).filter((g) => isLancamentosGroup(g.name));
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
}

/** Mensagem de alguém da equipe (contato salvo como "... - Lidera"), que não é lançamento de cliente. */
export function isTeamName(name: string) {
  return /\blidera\b/i.test(name) && !/\bPLL\b/.test(name);
}

/** Tudo que o cliente manda pode ser um lançamento: foto/PDF de nota ou texto com despesa (em qualquer formato). */
export function isItemCandidate(m: ChatMessage): boolean {
  if (isNoteCandidate(m)) return true;
  return m.kind === "texto" && Boolean(m.text.trim());
}

function itemType(m: ChatMessage): "foto" | "pdf" | "documento" | "texto" {
  if (m.kind === "imagem") return "foto";
  if (m.kind === "texto") return "texto";
  const mime = (m.mimetype || "").toLowerCase();
  const name = (m.fileName || "").toLowerCase();
  if (mime.startsWith("image/") || /\.(jpe?g|png|webp|heic)$/.test(name)) return "foto";
  if (mime.includes("pdf") || name.endsWith(".pdf")) return "pdf";
  return "documento";
}

type Names = Map<string, string>;

function toItem(m: ChatMessage, names: Names) {
  const numero = m.senderPhone || jidToPhone(m.senderJid);
  const salvo = numero ? names.get(numero) : undefined;
  const tipo = itemType(m);
  return {
    id: m.id,
    data: m.timestamp ? formatSaoPaulo(new Date(m.timestamp)) : null,
    autor: (salvo && salvo !== numero ? salvo : "") || m.senderName || numero || "Desconhecido",
    autorNumero: numero || null,
    tipo,
    /** Texto da mensagem, ou legenda da foto/PDF */
    texto: m.text || "",
    ...(tipo !== "texto" ? { temArquivo: true } : {}),
    ...(m.fileName ? { arquivo: m.fileName } : {}),
    ...(m.mimetype ? { mimetype: m.mimetype } : {}),
  };
}

export type PendingItem = ReturnType<typeof toItem>;

export interface PendingGroup {
  grupo: string;
  grupoId: string;
  itens: PendingItem[];
  erro?: string;
}

export async function collectPending(
  req: Request,
  creds: Creds,
  opts: { since: number; perGroup: number; only?: WaGroup },
): Promise<PendingGroup[]> {
  const groups = opts.only ? [opts.only] : await lancamentosGroups(creds);
  const contacts = await listContacts(creds, false).catch(() => []);
  const names: Names = new Map(contacts.map((c) => [c.phone, c.name]));

  return mapLimit(groups, 4, async (g): Promise<PendingGroup> => {
    try {
      const [page, marked] = await Promise.all([findMessages(creds, g.id, opts.perGroup, 0), listMarkedIds(req, g.id)]);
      const itens = page.messages
        .filter((m) => !m.fromMe && m.id && m.timestamp >= opts.since && isItemCandidate(m) && !marked.has(noteKey(m.id)))
        .map((m) => toItem(m, names))
        .filter((it) => !isTeamName(it.autor))
        .sort((a, b) => (a.data || "").localeCompare(b.data || ""));
      return { grupo: g.name, grupoId: g.id, itens };
    } catch (err) {
      return { grupo: g.name, grupoId: g.id, itens: [], erro: (err as Error).message };
    }
  });
}
