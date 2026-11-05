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
const BLOCK_GAP_MS = 10 * 60 * 1000;

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

export type { Names };

/** Tudo que o cliente manda pode ser um lançamento: foto/PDF de nota ou texto com despesa (em qualquer formato). */
export function isItemCandidate(m: ChatMessage): boolean {
  if (isNoteCandidate(m)) return true;
  return m.kind === "texto" && Boolean(m.text.trim());
}

export type DisplayType = "foto" | "pdf" | "documento" | "texto" | "audio" | "video" | "figurinha" | "reacao" | "contato" | "localizacao" | "enquete" | "outro";

/** Tipo exibido pelas rotas do agente (mesmo nome em /conversas e /lancamentos). */
export function displayType(m: ChatMessage): DisplayType {
  if (m.kind === "imagem") return "foto";
  if (m.kind !== "documento") return m.kind;
  const mime = (m.mimetype || "").toLowerCase();
  const name = (m.fileName || "").toLowerCase();
  if (mime.startsWith("image/") || /\.(jpe?g|png|webp|heic)$/.test(name)) return "foto";
  if (mime.includes("pdf") || name.endsWith(".pdf")) return "pdf";
  return "documento";
}

const EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/heic": "heic", "application/pdf": "pdf", "video/mp4": "mp4", "audio/ogg": "ogg", "audio/mpeg": "mp3" };

export function hasFile(m: ChatMessage) {
  return ["imagem", "documento", "video", "audio", "figurinha"].includes(m.kind);
}

/** Nome do arquivo: o original (PDFs) ou um nome gerado a partir do id e do tipo (fotos não têm nome). */
export function fileNameOf(m: ChatMessage): string {
  if (m.fileName) return m.fileName;
  const mime = (m.mimetype || "").split(";")[0].trim().toLowerCase();
  const ext = EXT[mime] || (m.kind === "imagem" ? "jpg" : "bin");
  return `${m.kind === "imagem" ? "foto" : "arquivo"}-${m.id.replace(/[^A-Za-z0-9_-]+/g, "").slice(0, 40)}.${ext}`;
}

/** Caminho para baixar o arquivo da mensagem pela rota do agente. */
export function downloadPath(grupoId: string, id: string) {
  return `/api/agente/lancamentos/arquivo?grupoId=${encodeURIComponent(grupoId)}&id=${encodeURIComponent(id)}`;
}

type Names = Map<string, string>;

export function authorOf(m: ChatMessage, names: Names) {
  const numero = m.senderPhone || jidToPhone(m.senderJid);
  const salvo = numero ? names.get(numero) : undefined;
  return { autor: (salvo && salvo !== numero ? salvo : "") || m.senderName || numero || "Desconhecido", autorNumero: numero || null };
}

/** Campos comuns a /conversas e /lancamentos/pendentes. */
export function messageView(m: ChatMessage, grupoId: string, names: Names) {
  const file = hasFile(m);
  return {
    id: m.id,
    data: m.timestamp ? formatSaoPaulo(new Date(m.timestamp)) : null,
    ...authorOf(m, names),
    tipo: displayType(m),
    /** Texto da mensagem, ou legenda da foto/PDF */
    texto: m.text || "",
    temArquivo: file,
    ...(file ? { arquivo: fileNameOf(m), mimetype: m.mimetype || null, download: downloadPath(grupoId, m.id) } : {}),
    ...(m.quotedId ? { respondendo: m.quotedId } : {}),
  };
}

function toItem(m: ChatMessage, grupoId: string, names: Names) {
  return { ...messageView(m, grupoId, names), bloco: 0 };
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
      const msgs = page.messages
        .filter((m) => !m.fromMe && m.id && m.timestamp >= opts.since && isItemCandidate(m) && !marked.has(noteKey(m.id)))
        .sort((a, b) => a.timestamp - b.timestamp);
      const itens: PendingItem[] = [];
      // "bloco": mensagens seguidas da mesma pessoa, com até 10 min entre uma e outra (ex.: foto da nota + texto explicando).
      let bloco = 0;
      let prev: { autor: string; ts: number } | null = null;
      for (const m of msgs) {
        const it = toItem(m, g.id, names);
        if (isTeamName(it.autor)) continue;
        if (!prev || prev.autor !== it.autor || m.timestamp - prev.ts > BLOCK_GAP_MS) bloco++;
        it.bloco = bloco;
        prev = { autor: it.autor, ts: m.timestamp };
        itens.push(it);
      }
      return { grupo: g.name, grupoId: g.id, itens };
    } catch (err) {
      return { grupo: g.name, grupoId: g.id, itens: [], erro: (err as Error).message };
    }
  });
}

export const MAX_FILES_CAP = 100;

/**
 * Limita quantos arquivos (fotos/PDFs) saem numa busca, para a tarefa não estourar o limite de imagens por conversa.
 * Corta por bloco (foto da nota + texto que a acompanha ficam juntos); só divide um bloco quando ele sozinho passa do limite.
 * Grupos com itens mais antigos vêm primeiro. O que não coube continua pendente para a próxima busca.
 */
export function capFiles(groups: PendingGroup[], maxFiles: number) {
  const ordered = [...groups].sort((a, b) => (a.itens[0]?.data || "~").localeCompare(b.itens[0]?.data || "~"));
  let files = 0;
  let full = false;
  let leftItems = 0;
  let leftFiles = 0;
  const out: PendingGroup[] = [];
  for (const g of ordered) {
    const kept: PendingItem[] = [];
    const blocks = new Map<number, PendingItem[]>();
    for (const it of g.itens) blocks.set(it.bloco, [...(blocks.get(it.bloco) || []), it]);
    for (const block of blocks.values()) {
      const blockFiles = block.filter((it) => it.temArquivo).length;
      if (!full && files + blockFiles <= maxFiles) {
        kept.push(...block);
        files += blockFiles;
        continue;
      }
      if (!full && files === 0) {
        // Bloco maior que o limite sozinho: leva até o limite e deixa o resto do bloco para depois.
        for (const it of block) {
          if (!full && (!it.temArquivo || files < maxFiles)) {
            kept.push(it);
            if (it.temArquivo) files++;
          } else {
            full = true;
            leftItems++;
            if (it.temArquivo) leftFiles++;
          }
        }
        full = true;
        continue;
      }
      full = true;
      leftItems += block.length;
      leftFiles += blockFiles;
    }
    if (kept.length > 0 || g.erro) out.push({ ...g, itens: kept });
  }
  return { grupos: out, arquivos: files, restantes: { itens: leftItems, arquivos: leftFiles } };
}
