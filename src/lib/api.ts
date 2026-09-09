import { NextResponse } from "next/server";
import { UazapiError } from "./uazapi";

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
