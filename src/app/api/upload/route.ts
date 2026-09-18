import { del } from "@vercel/blob";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { fail, handle, ok } from "@/lib/api";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Limite por arquivo no Vercel Blob. O WhatsApp aceita vídeos até ~64 MB e documentos maiores. */
export const BLOB_MAX_BYTES = 100 * 1024 * 1024;
/** Limite do modo reserva (arquivo embutido em base64 no corpo da requisição; a Vercel corta em 4,5 MB). */
export const INLINE_MAX_BYTES = 3 * 1024 * 1024;

function blobEnabled() {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

/** Capacidade de upload: informa ao navegador se o armazenamento de arquivos grandes está ligado. */
export const GET = handle(async () => {
  return ok({ blob: blobEnabled(), maxBytes: blobEnabled() ? BLOB_MAX_BYTES : INLINE_MAX_BYTES, inlineMaxBytes: INLINE_MAX_BYTES });
});

/**
 * Gera o token para o navegador enviar o arquivo direto ao Vercel Blob (sem passar pelo limite de 4,5 MB),
 * e recebe a confirmação de conclusão.
 */
export const POST = handle(async (req: Request) => {
  if (!blobEnabled()) return fail("Armazenamento de arquivos não configurado (BLOB_READ_WRITE_TOKEN).", 501);
  const body = (await req.json()) as HandleUploadBody;
  const result = await handleUpload({
    body,
    request: req,
    onBeforeGenerateToken: async (pathname) => ({
      allowedContentTypes: ["image/*", "video/*", "audio/*", "application/*", "text/*"],
      maximumSizeInBytes: BLOB_MAX_BYTES,
      addRandomSuffix: true,
      tokenPayload: JSON.stringify({ pathname }),
    }),
    onUploadCompleted: async () => {
      /* nada a fazer: o navegador já recebe a URL */
    },
  });
  return ok(result);
});

/** Remove um arquivo do Blob (depois do disparo ou ao tirar o anexo). */
export const DELETE = handle(async (req: Request) => {
  if (!blobEnabled()) return ok({ ok: true });
  const url = new URL(req.url).searchParams.get("url") || "";
  if (!/^https:\/\/[a-z0-9.-]*\.public\.blob\.vercel-storage\.com\//i.test(url)) return fail("URL inválida.");
  await del(url).catch(() => null);
  return ok({ ok: true });
});
