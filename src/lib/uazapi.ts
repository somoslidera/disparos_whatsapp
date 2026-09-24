import type { InstanceStatus, WaContact, WaGroup, WaParticipant } from "./types";
import { isGroupJid, jidToPhone, toContactJid } from "./phone";

/**
 * Cliente da API uazapi (v2).
 * Docs: https://docs.uazapi.com
 *
 * Autenticação: header `token` com o token da instância.
 * As credenciais vêm do navegador (headers x-uazapi-url / x-uazapi-token)
 * ou, como alternativa para instalação própria, das variáveis de ambiente.
 */

export class UazapiError extends Error {
  status: number;
  body: unknown;
  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.name = "UazapiError";
    this.status = status;
    this.body = body;
  }
}

export interface Creds {
  url: string;
  token: string;
}

function normalizeCreds(creds: Creds): Creds {
  const url = (creds.url || "").trim().replace(/\/+$/, "");
  const token = (creds.token || "").trim();
  if (!url || !token) {
    throw new UazapiError("Informe a URL do servidor e o token da instância do uazapi na tela Conexão.", 428, null);
  }
  if (!/^https?:\/\//i.test(url)) {
    throw new UazapiError("A URL do uazapi deve começar com https://", 400, null);
  }
  return { url, token };
}

type Json = Record<string, unknown>;

async function request<T = Json>(
  creds: Creds,
  method: "GET" | "POST" | "PUT" | "DELETE",
  path: string,
  body?: unknown,
  opts: { timeoutMs?: number } = {},
): Promise<T> {
  const { url, token } = normalizeCreds(creds);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 60_000);
  try {
    const res = await fetch(`${url}${path}`, {
      method,
      headers: {
        token,
        Accept: "application/json",
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
      cache: "no-store",
    });
    const text = await res.text();
    let data: unknown = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }
    if (!res.ok) {
      const detail = extractError(data);
      let msg = detail || `uazapi respondeu ${res.status} em ${method} ${path}`;
      if (res.status === 401 || res.status === 403) {
        msg = `O uazapi recusou o token da instância (${res.status}${detail ? `: ${detail}` : ""}). Confira o Instance Token na tela Conexão.`;
      } else if (res.status === 404 && /instance/i.test(path)) {
        msg = `Instância não encontrada no servidor ${url}. Confira a URL e o token na tela Conexão.`;
      }
      // Erros de credencial do uazapi viram 502 aqui para não se confundirem com a senha do app.
      const status = res.status === 401 || res.status === 403 ? 502 : res.status;
      throw new UazapiError(msg, status, data);
    }
    return data as T;
  } catch (err) {
    if (err instanceof UazapiError) throw err;
    const e = err as Error;
    const msg =
      e.name === "AbortError"
        ? `Tempo esgotado ao chamar ${method} ${path}`
        : `Falha de rede ao chamar ${method} ${path}: ${e.message}`;
    throw new UazapiError(msg, 502, null);
  } finally {
    clearTimeout(timer);
  }
}

function extractError(data: unknown): string | null {
  if (!data) return null;
  if (typeof data === "string") return data.slice(0, 300);
  const d = data as Json;
  for (const key of ["error", "message", "msg", "detail"]) {
    const v = d[key];
    if (typeof v === "string" && v.trim()) return v;
    if (v && typeof v === "object" && typeof (v as Json).message === "string") {
      return (v as Json).message as string;
    }
  }
  return null;
}

function str(v: unknown): string {
  return typeof v === "string" ? v : typeof v === "number" ? String(v) : "";
}

function pick(obj: Json, ...keys: string[]): unknown {
  for (const k of keys) {
    if (obj[k] !== undefined && obj[k] !== null && obj[k] !== "") return obj[k];
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Instância
// ---------------------------------------------------------------------------

function normalizeStatus(data: Json): InstanceStatus {
  const instance = (data.instance as Json) || data;
  const status = (data.status as Json) || {};
  const rawState = str(pick(instance, "status", "state")) || str(pick(status, "status", "state"));
  const connected =
    typeof status.connected === "boolean"
      ? status.connected
      : typeof instance.connected === "boolean"
        ? instance.connected
        : /^(connected|open|online)$/i.test(rawState);
  const loggedIn =
    typeof status.loggedIn === "boolean"
      ? status.loggedIn
      : typeof instance.loggedIn === "boolean"
        ? instance.loggedIn
        : connected;
  const jid = str(pick(status, "jid") ?? pick(instance, "jid", "owner", "wid"));
  return {
    connected,
    loggedIn,
    status: rawState || (connected ? "connected" : "disconnected"),
    name: str(pick(instance, "name", "instanceName")) || undefined,
    profileName: str(pick(instance, "profileName", "pushName", "pushname")) || undefined,
    phone: jid ? jidToPhone(jid) : undefined,
    jid: jid || undefined,
    profilePicUrl: str(pick(instance, "profilePicUrl", "profilePic", "picture")) || null,
    qrcode: str(pick(instance, "qrcode", "qr", "base64")) || null,
    paircode: str(pick(instance, "paircode", "pairingCode")) || null,
  };
}

export async function getInstanceStatus(creds: Creds): Promise<InstanceStatus> {
  const data = await request<Json>(creds, "GET", "/instance/status");
  return normalizeStatus(data);
}

export async function connectInstance(creds: Creds, phone?: string): Promise<InstanceStatus> {
  const data = await request<Json>(creds, "POST", "/instance/connect", phone ? { phone } : {});
  return normalizeStatus(data);
}

export async function disconnectInstance(creds: Creds): Promise<void> {
  await request(creds, "POST", "/instance/disconnect", {});
}

// ---------------------------------------------------------------------------
// Grupos e contatos
// ---------------------------------------------------------------------------

function asArray(data: unknown, ...keys: string[]): Json[] {
  if (Array.isArray(data)) return data as Json[];
  if (data && typeof data === "object") {
    const d = data as Json;
    for (const k of keys) {
      if (Array.isArray(d[k])) return d[k] as Json[];
    }
    for (const v of Object.values(d)) {
      if (Array.isArray(v) && v.length && typeof v[0] === "object") return v as Json[];
    }
  }
  return [];
}

export async function listGroups(creds: Creds, force = false): Promise<WaGroup[]> {
  const data = await request<unknown>(creds, "GET", `/group/list?force=${force ? "true" : "false"}`, undefined, {
    timeoutMs: 120_000,
  });
  const groups = asArray(data, "groups", "data", "items");
  const out: WaGroup[] = [];
  for (const g of groups) {
    const id = str(pick(g, "JID", "jid", "id", "groupId", "wa_chatid"));
    if (!id || !isGroupJid(id)) continue;
    const name = str(pick(g, "Name", "name", "subject", "wa_name")) || id.split("@")[0];
    const participantsRaw = pick(g, "Participants", "participants", "size", "participantsCount");
    const participants = Array.isArray(participantsRaw)
      ? participantsRaw.length
      : typeof participantsRaw === "number"
        ? participantsRaw
        : 0;
    out.push({
      id,
      name,
      participants,
      image: str(pick(g, "image", "imagePreview", "picture", "profilePicUrl")) || null,
    });
  }
  out.sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  return out;
}

function normalizeParticipant(p: Json): WaParticipant | null {
  const rawJid = str(pick(p, "JID", "jid", "id", "participant"));
  const phoneRaw = str(pick(p, "PhoneNumber", "phoneNumber", "phone", "number"));
  if (!rawJid && !phoneRaw) return null;
  // Em grupos novos o WhatsApp entrega o LID (@lid); quando o número vem junto, preferimos o jid do telefone.
  const isLid = /@lid$/i.test(rawJid);
  const id = isLid && phoneRaw ? toContactJid(phoneRaw) : rawJid || toContactJid(phoneRaw);
  if (isGroupJid(id)) return null;
  const phone = /@lid$/i.test(id) ? jidToPhone(phoneRaw) : jidToPhone(id);
  const name = str(pick(p, "DisplayName", "displayName", "name", "PushName", "pushName", "notify", "wa_contactName", "wa_name"));
  return {
    id,
    phone,
    name: name || (phone ? "" : "Número oculto"),
    isAdmin: Boolean(p.IsAdmin || p.isAdmin || p.IsSuperAdmin || p.isSuperAdmin || p.admin),
  };
}

function participantsOf(g: Json): WaParticipant[] {
  const raw = pick(g, "Participants", "participants", "members");
  if (!Array.isArray(raw)) return [];
  const out = new Map<string, WaParticipant>();
  for (const item of raw) {
    const p = typeof item === "string" ? { JID: item } : (item as Json);
    const n = normalizeParticipant(p);
    if (n && !out.has(n.id)) out.set(n.id, n);
  }
  return [...out.values()];
}

/** Participantes de um grupo: tenta /group/info e, se vier vazio, usa a lista de grupos. */
export async function getGroupParticipants(creds: Creds, groupJid: string): Promise<WaParticipant[]> {
  let participants: WaParticipant[] = [];
  try {
    const data = await request<Json>(creds, "GET", `/group/info?groupjid=${encodeURIComponent(groupJid)}`, undefined, { timeoutMs: 60_000 });
    const g = (data.group as Json) || (data.data as Json) || data;
    participants = participantsOf(g);
  } catch (err) {
    if ((err as UazapiError).status === 428 || (err as UazapiError).status === 400) throw err;
  }
  if (participants.length === 0) {
    const data = await request<unknown>(creds, "GET", "/group/list?force=false", undefined, { timeoutMs: 120_000 });
    const g = asArray(data, "groups", "data", "items").find((x) => str(pick(x, "JID", "jid", "id", "groupId", "wa_chatid")) === groupJid);
    if (g) participants = participantsOf(g);
  }
  return participants.sort((a, b) => (a.name || a.phone).localeCompare(b.name || b.phone, "pt-BR"));
}

function normalizeContact(c: Json): WaContact | null {
  const rawId = str(pick(c, "wa_chatid", "jid", "JID", "id", "chatId", "remoteJid", "phone", "number"));
  if (!rawId) return null;
  if (isGroupJid(rawId)) return null;
  if (/@(broadcast|newsletter)$/i.test(rawId) || rawId === "status@broadcast") return null;
  const id = toContactJid(rawId);
  const phone = str(pick(c, "phone")) ? jidToPhone(str(pick(c, "phone"))) : jidToPhone(id);
  if (!phone || phone.length < 8) return null;
  const name =
    str(
      pick(
        c,
        "contact_name",
        "contact_FirstName",
        "wa_contactName",
        "lead_fullName",
        "lead_name",
        "wa_name",
        "name",
        "FullName",
        "fullName",
        "PushName",
        "pushName",
        "pushname",
        "notify",
        "verifiedName",
      ),
    ) || phone;
  return {
    id,
    phone,
    name,
    image: str(pick(c, "imagePreview", "image", "profilePicUrl", "picture")) || null,
  };
}

/** Lista contatos combinando a agenda (/contacts) e as conversas (/chat/find). */
export async function listContacts(creds: Creds, force = false): Promise<WaContact[]> {
  const map = new Map<string, WaContact>();
  const errors: string[] = [];
  const diag: string[] = [];

  // 1) Agenda de contatos
  try {
    const data = await request<unknown>(creds, "GET", `/contacts${force ? "?force=true" : ""}`, undefined, { timeoutMs: 120_000 });
    const rows = asArray(data, "contacts", "data", "items");
    let kept = 0;
    for (const raw of rows) {
      const c = normalizeContact(raw);
      if (c) {
        map.set(c.id, c);
        kept++;
      }
    }
    const sample = rows[0] ? Object.keys(rows[0]).join(",") : "vazio";
    diag.push(`agenda: ${rows.length} itens, ${kept} válidos, campos: ${sample}`);
    if (rows.length === 0 && data && typeof data === "object" && !Array.isArray(data)) diag.push(`agenda: chaves da resposta: ${Object.keys(data as object).join(",")}`);
  } catch (err) {
    errors.push((err as Error).message);
    diag.push(`agenda: erro ${(err as Error).message}`);
  }

  // 2) Conversas (inclui pessoas fora da agenda)
  try {
    const data = await request<unknown>(
      creds,
      "POST",
      "/chat/find",
      { operator: "AND", sort: "-wa_lastMsgTimestamp", limit: 2000, offset: 0 },
      { timeoutMs: 120_000 },
    );
    const rows = asArray(data, "chats", "data", "items");
    let named = 0;
    for (const raw of rows) {
      if (raw.wa_isGroup === true) continue;
      const c = normalizeContact(raw);
      if (!c) continue;
      if (c.name !== c.phone) named++;
      const existing = map.get(c.id);
      if (!existing) map.set(c.id, c);
      else if (existing.name === existing.phone && c.name !== c.phone) map.set(c.id, { ...existing, name: c.name });
    }
    const sample = rows[0] ? Object.keys(rows[0]).join(",") : "vazio";
    diag.push(`conversas: ${rows.length} itens, ${named} com nome, campos: ${sample}`);
  } catch (err) {
    errors.push((err as Error).message);
    diag.push(`conversas: erro ${(err as Error).message}`);
  }

  console.info("[contacts]", diag.join(" | "));

  if (map.size === 0 && errors.length === 2) {
    throw new UazapiError(`Não foi possível carregar os contatos: ${errors.join(" | ")}`, 502, null);
  }

  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
}

// ---------------------------------------------------------------------------
// Envio
// ---------------------------------------------------------------------------

export interface SendResult {
  messageId?: string;
  raw: unknown;
}

function extractMessageId(data: unknown): string | undefined {
  if (!data || typeof data !== "object") return undefined;
  const d = data as Json;
  const direct = pick(d, "messageid", "messageId", "id");
  if (typeof direct === "string") return direct;
  const key = d.key as Json | undefined;
  if (key && typeof key.id === "string") return key.id;
  return undefined;
}

export async function sendText(creds: Creds, number: string, text: string): Promise<SendResult> {
  const data = await request<unknown>(creds, "POST", "/send/text", { number, text, linkPreview: true });
  return { messageId: extractMessageId(data), raw: data };
}

export type MediaType = "image" | "video" | "audio" | "ptt" | "document";

export interface SendMediaInput {
  number: string;
  type: MediaType;
  /** URL pública ou data URI base64 */
  file: string;
  caption?: string;
  fileName?: string;
  mimetype?: string;
}

export async function sendMedia(creds: Creds, input: SendMediaInput): Promise<SendResult> {
  const body: Json = {
    number: input.number,
    type: input.type,
    file: input.file,
  };
  if (input.caption) body.text = input.caption;
  if (input.fileName) body.docName = input.fileName;
  if (input.mimetype) body.mimetype = input.mimetype;
  const data = await request<unknown>(creds, "POST", "/send/media", body, { timeoutMs: 180_000 });
  return { messageId: extractMessageId(data), raw: data };
}
