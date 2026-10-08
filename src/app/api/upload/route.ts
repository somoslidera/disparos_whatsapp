import { del, issueSignedToken } from "@vercel/blob";
import { handleUpload, handleUploadPresigned, type HandleUploadBody, type HandleUploadPresignedBody } from "@vercel/blob/client";
import { fail, handle, ok } from "@/lib/api";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Limite por arquivo no Vercel Blob. O WhatsApp aceita vídeos até ~64 MB e documentos maiores. */
export const BLOB_MAX_BYTES = 100 * 1024 * 1024;
/** Limite do modo reserva (arquivo embutido em base64 no corpo da requisição; a Vercel corta em 4,5 MB). */
export const INLINE_MAX_BYTES = 3 * 1024 * 1024;

const ALLOWED_TYPES = ["image/*", "video/*", "audio/*", "application/*", "text/*"];

/**
 * Credenciais do Vercel Blob. Há dois modelos:
 * - clássico: BLOB_READ_WRITE_TOKEN (prefixo pode ter sido personalizado) → upload por client token;
 * - novo: BLOB_STORE_ID + token de identidade do deploy (header x-vercel-oidc-token) → upload por URL pré-assinada.
 */
function blobToken(): string | undefined {
  if (process.env.BLOB_READ_WRITE_TOKEN) return process.env.BLOB_READ_WRITE_TOKEN;
  for (const [name, value] of Object.entries(process.env)) {
    if (name.endsWith("_READ_WRITE_TOKEN") && value && value.startsWith("vercel_blob_rw_")) return value;
  }
  return undefined;
}

function oidcToken(req: Request): string | undefined {
  return req.headers.get("x-vercel-oidc-token") || process.env.VERCEL_OIDC_TOKEN || undefined;
}

type Mode = "token" | "presigned" | "none";

function blobMode(req: Request): Mode {
  if (blobToken()) return "token";
  if (process.env.BLOB_STORE_ID && oidcToken(req)) return "presigned";
  return "none";
}

/** Capacidade de upload: informa ao navegador se o armazenamento de arquivos grandes está ligado e qual fluxo usar. */
export const GET = handle(async (req: Request) => {
  const mode = blobMode(req);
  const enabled = mode !== "none";
  if (!enabled) {
    const names = Object.keys(process.env).filter((n) => /BLOB|READ_WRITE|STORE|OIDC/i.test(n));
    console.warn("[upload] Vercel Blob não detectado. Variáveis:", names.join(", ") || "nenhuma", "| header oidc:", req.headers.has("x-vercel-oidc-token") ? "presente" : "ausente");
  }
  return ok({ blob: enabled, mode, maxBytes: enabled ? BLOB_MAX_BYTES : INLINE_MAX_BYTES, inlineMaxBytes: INLINE_MAX_BYTES });
});

/** Gera a credencial para o navegador enviar o arquivo direto ao Vercel Blob (sem passar pelo limite de 4,5 MB). */
export const POST = handle(async (req: Request) => {
  const mode = blobMode(req);
  if (mode === "none") return fail("Armazenamento de arquivos não configurado (Vercel Blob).", 501);
  const body = (await req.json()) as HandleUploadBody | HandleUploadPresignedBody;

  try {
    if (mode === "token") {
      const result = await handleUpload({
        token: blobToken(),
        body: body as HandleUploadBody,
        request: req,
        onBeforeGenerateToken: async (pathname) => ({
          allowedContentTypes: ALLOWED_TYPES,
          maximumSizeInBytes: BLOB_MAX_BYTES,
          addRandomSuffix: true,
          tokenPayload: JSON.stringify({ pathname }),
        }),
      });
      return ok(result);
    }

    const result = await handleUploadPresigned({
      body: body as HandleUploadPresignedBody,
      request: req,
      getSignedToken: async (pathname) => ({
        token: await issueSignedToken({
          oidcToken: oidcToken(req),
          storeId: process.env.BLOB_STORE_ID,
          pathname,
          operations: ["put"],
          allowedContentTypes: ALLOWED_TYPES,
          maximumSizeInBytes: BLOB_MAX_BYTES,
          validUntil: Date.now() + 60 * 60 * 1000,
        }),
        urlOptions: { addRandomSuffix: true, allowedContentTypes: ALLOWED_TYPES, maximumSizeInBytes: BLOB_MAX_BYTES },
      }),
    });
    return ok(result);
  } catch (err) {
    console.error("[upload] falha ao autorizar upload:", (err as Error).message);
    return fail(`Falha ao autorizar o envio do arquivo: ${(err as Error).message}`, 502);
  }
});

/** Remove um arquivo do Blob (depois do disparo ou ao tirar o anexo). */
export const DELETE = handle(async (req: Request) => {
  const mode = blobMode(req);
  if (mode === "none") return ok({ ok: true });
  const url = new URL(req.url).searchParams.get("url") || "";
  if (!/^https:\/\/[a-z0-9.-]*\.public\.blob\.vercel-storage\.com\//i.test(url)) return fail("URL inválida.");
  const auth = mode === "token" ? { token: blobToken() } : { oidcToken: oidcToken(req), storeId: process.env.BLOB_STORE_ID };
  await del(url, auth).catch((err: Error) => console.warn("[upload] falha ao apagar:", err.message));
  return ok({ ok: true });
});
