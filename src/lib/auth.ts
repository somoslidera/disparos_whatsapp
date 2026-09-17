/**
 * Proteção opcional por senha (APP_PASSWORD).
 * Usa Web Crypto (disponível no Node e no runtime do proxy) para não depender de chamadas internas.
 */

export const AUTH_COOKIE = "disparos_session";

export function isAuthEnabled(): boolean {
  return Boolean(process.env.APP_PASSWORD);
}

function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Token de sessão: HMAC-SHA256 derivado da senha configurada. */
export async function sessionToken(): Promise<string> {
  const enc = new TextEncoder();
  const secret = `${process.env.APP_PASSWORD || ""}::${process.env.UAZAPI_TOKEN || ""}::disparos`;
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode("disparos-session-v2"));
  return toHex(sig);
}

export async function isValidSession(value: string | undefined): Promise<boolean> {
  if (!isAuthEnabled()) return true;
  if (!value) return false;
  return constantTimeEqual(await sessionToken(), value);
}

export function checkPassword(password: string): boolean {
  const expected = process.env.APP_PASSWORD || "";
  return expected.length > 0 && constantTimeEqual(expected, password || "");
}
