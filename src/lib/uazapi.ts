import type { InstanceStatus, WaContact, WaGroup } from "./types";
import { isGroupJid, jidToPhone, toContactJid } from "./phone";

/**
 * Cliente da API uazapi (v2).
 * Docs: https://docs.uazapi.com
 *
 * Autenticação: header `token` com o token da instância.
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

function config() {
  const url = (process.env.UAZAPI_URL || "").replace(/\/+$/, "");
  const token = process.env.UAZAPI_TOKEN || "";
  if (!url || !token) {
    throw new UazapiError(
      "Configure UAZAPI_URL e UAZAPI_TOKEN no arquivo .env para conectar ao uazapi.",
      500,
      null,
    );
  }
  return { url, token };
}

export function isConfigured(): boolean {
  return Boolean(process.env.UAZAPI_URL && process.env.UAZAPI_TOKEN);
}

type Json = Record<string, unknown>;

async function request<T = Json>(
  method: "GET" | "POST" | "PUT" | "DELETE",
  path: string,
  body?: unknown,
  opts: { timeoutMs?: number } = {},
): Promise<T> {
  const { url, token } = config();
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
      const msg = extractError(data) || `uazapi respondeu ${res.status} em ${method} ${path}`;
      throw new UazapiError(msg, res.status, data);
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

export async function getInstanceStatus(): Promise<InstanceStatus> {
  const data = await request<Json>("GET", "/instance/status");
  return normalizeStatus(data);
}

export async function connectInstance(phone?: string): Promise<InstanceStatus> {
  const data = await request<Json>("POST", "/instance/connect", phone ? { phone } : {});
  return normalizeStatus(data);
}

export async function disconnectInstance(): Promise<void> {
  await request("POST", "/instance/disconnect", {});
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

export async function listGroups(force = false): Promise<WaGroup[]> {
  const data = await request<unknown>("GET", `/group/list?force=${force ? "true" : "false"}`, undefined, {
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
export async function listContacts(): Promise<WaContact[]> {
  const map = new Map<string, WaContact>();
  const errors: string[] = [];

  // 1) Agenda de contatos
  try {
    const data = await request<unknown>("GET", "/contacts", undefined, { timeoutMs: 120_000 });
    for (const raw of asArray(data, "contacts", "data", "items")) {
      const c = normalizeContact(raw);
      if (c) map.set(c.id, c);
    }
  } catch (err) {
    errors.push((err as Error).message);
  }

  // 2) Conversas (inclui pessoas fora da agenda)
  try {
    const data = await request<unknown>(
      "POST",
      "/chat/find",
      { operator: "AND", sort: "-wa_lastMsgTimestamp", limit: 2000, offset: 0 },
      { timeoutMs: 120_000 },
    );
    for (const raw of asArray(data, "chats", "data", "items")) {
      if (raw.wa_isGroup === true) continue;
      const c = normalizeContact(raw);
      if (!c) continue;
      const existing = map.get(c.id);
      if (!existing) map.set(c.id, c);
      else if (existing.name === existing.phone && c.name !== c.phone) map.set(c.id, { ...existing, name: c.name });
    }
  } catch (err) {
    errors.push((err as Error).message);
  }

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

export async function sendText(number: string, text: string): Promise<SendResult> {
  const data = await request<unknown>("POST", "/send/text", { number, text, linkPreview: true });
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

export async function sendMedia(input: SendMediaInput): Promise<SendResult> {
  const body: Json = {
    number: input.number,
    type: input.type,
    file: input.file,
  };
  if (input.caption) body.text = input.caption;
  if (input.fileName) body.docName = input.fileName;
  if (input.mimetype) body.mimetype = input.mimetype;
  const data = await request<unknown>("POST", "/send/media", body, { timeoutMs: 180_000 });
  return { messageId: extractMessageId(data), raw: data };
}
