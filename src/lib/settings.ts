"use client";

import type { UazapiSettings } from "./types";

const KEY = "disparos:uazapi";
const listeners = new Set<() => void>();
let cache: UazapiSettings | null | undefined;

function read(): UazapiSettings | null {
  if (cache !== undefined) return cache;
  try {
    const raw = typeof window !== "undefined" ? localStorage.getItem(KEY) : null;
    cache = raw ? (JSON.parse(raw) as UazapiSettings) : null;
  } catch {
    cache = null;
  }
  return cache;
}

export function getSettings(): UazapiSettings | null {
  return read();
}

export function saveSettings(s: UazapiSettings | null) {
  cache = s;
  try {
    if (s) localStorage.setItem(KEY, JSON.stringify(s));
    else localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
  listeners.forEach((l) => l());
}

export function subscribeSettings(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

/** Headers enviados às rotas /api para que o servidor fale com o uazapi do usuário. */
export function credentialHeaders(): Record<string, string> {
  const s = read();
  if (!s?.url || !s?.token) return {};
  return { "x-uazapi-url": s.url.trim().replace(/\/+$/, ""), "x-uazapi-token": s.token.trim() };
}
