/**
 * Credenciais do Vercel Blob para uso no servidor. Dois modelos:
 * - clássico: BLOB_READ_WRITE_TOKEN (prefixo pode ter sido personalizado);
 * - novo: BLOB_STORE_ID + token de identidade do deploy (header x-vercel-oidc-token).
 */

export type BlobMode = "token" | "presigned" | "none";

export interface BlobAuth {
  token?: string;
  oidcToken?: string;
  storeId?: string;
}

export function blobReadWriteToken(): string | undefined {
  if (process.env.BLOB_READ_WRITE_TOKEN) return process.env.BLOB_READ_WRITE_TOKEN;
  for (const [name, value] of Object.entries(process.env)) {
    if (name.endsWith("_READ_WRITE_TOKEN") && value && value.startsWith("vercel_blob_rw_")) return value;
  }
  return undefined;
}

export function blobOidcToken(req: Request): string | undefined {
  return req.headers.get("x-vercel-oidc-token") || process.env.VERCEL_OIDC_TOKEN || undefined;
}

export function blobMode(req: Request): BlobMode {
  if (blobReadWriteToken()) return "token";
  if (process.env.BLOB_STORE_ID && blobOidcToken(req)) return "presigned";
  return "none";
}

/** Opções de autenticação para as funções do SDK (put, get, list, del, issueSignedToken). */
export function blobAuth(req: Request): BlobAuth {
  const token = blobReadWriteToken();
  if (token) return { token };
  return { oidcToken: blobOidcToken(req), storeId: process.env.BLOB_STORE_ID };
}
