import { NextResponse } from "next/server";
import { UazapiError, type Creds } from "./uazapi";

export function ok<T>(data: T, init?: ResponseInit) {
  return NextResponse.json(data, init);
}

export function fail(message: string, status = 400, extra?: Record<string, unknown>) {
  return NextResponse.json({ error: message, ...extra }, { status });
}

/** Envolve um handler convertendo erros conhecidos em respostas JSON. */
export function handle<Args extends unknown[]>(fn: (...args: Args) => Promise<Response>) {
  return async (...args: Args): Promise<Response> => {
    try {
      return await fn(...args);
    } catch (err) {
      if (err instanceof UazapiError) {
        return fail(err.message, err.status >= 400 && err.status < 600 ? err.status : 502, {
          source: "uazapi",
        });
      }
      const e = err as Error;
      console.error(e);
      return fail(e.message || "Erro interno", 500);
    }
  };
}

/** Credenciais do uazapi: headers enviados pelo navegador, com fallback para o .env. */
export function getCreds(req: Request): Creds {
  const url = req.headers.get("x-uazapi-url") || process.env.UAZAPI_URL || "";
  const token = req.headers.get("x-uazapi-token") || process.env.UAZAPI_TOKEN || "";
  return { url, token };
}

export function hasEnvCreds(): boolean {
  return Boolean(process.env.UAZAPI_URL && process.env.UAZAPI_TOKEN);
}
