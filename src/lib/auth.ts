import { createHmac, timingSafeEqual } from "node:crypto";

export const AUTH_COOKIE = "disparos_session";

export function isAuthEnabled(): boolean {
  return Boolean(process.env.APP_PASSWORD);
}

function secret(): string {
  return `${process.env.APP_PASSWORD || ""}::${process.env.UAZAPI_TOKEN || ""}`;
}

export function sessionToken(): string {
  return createHmac("sha256", secret()).update("disparos-session-v1").digest("hex");
}

export function isValidSession(value: string | undefined): boolean {
  if (!isAuthEnabled()) return true;
  if (!value) return false;
  const expected = Buffer.from(sessionToken());
  const got = Buffer.from(value);
  return expected.length === got.length && timingSafeEqual(expected, got);
}

export function checkPassword(password: string): boolean {
  const expected = Buffer.from(process.env.APP_PASSWORD || "");
  const got = Buffer.from(password || "");
  return expected.length > 0 && expected.length === got.length && timingSafeEqual(expected, got);
}
