"use client";

import { upload } from "@vercel/blob/client";
import { nanoid } from "nanoid";
import { api, fileToDataUrl } from "./client";
import type { Attachment, AttachmentKind } from "./types";

export interface UploadCapability {
  blob: boolean;
  maxBytes: number;
  inlineMaxBytes: number;
}

let capability: Promise<UploadCapability> | null = null;

/** Descobre (uma vez) se o armazenamento de arquivos grandes está ligado. */
export function getUploadCapability(): Promise<UploadCapability> {
  if (!capability) {
    capability = api<UploadCapability>("/api/upload").catch(() => ({ blob: false, maxBytes: 3 * 1024 * 1024, inlineMaxBytes: 3 * 1024 * 1024 }));
  }
  return capability;
}

export function kindFromMime(mime: string, name: string): AttachmentKind {
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  const ext = name.toLowerCase().split(".").pop() || "";
  if (["jpg", "jpeg", "png", "gif", "webp"].includes(ext)) return "image";
  if (["mp4", "mov", "webm", "3gp"].includes(ext)) return "video";
  if (["mp3", "ogg", "opus", "m4a", "aac", "wav"].includes(ext)) return "audio";
  return "document";
}

function safeName(name: string) {
  return name.replace(/[^\w.\-]+/g, "_").slice(-120) || "arquivo";
}

/**
 * Prepara um anexo: com o Blob ligado, o arquivo sobe direto do navegador para o armazenamento
 * e o anexo guarda apenas a URL; sem Blob, o arquivo é embutido em base64 (limite pequeno).
 */
export async function prepareAttachment(file: File, onProgress?: (pct: number) => void): Promise<Attachment> {
  const cap = await getUploadCapability();
  const mime = file.type || "application/octet-stream";
  const kind = kindFromMime(mime, file.name);
  const base = { id: nanoid(10), name: file.name, mime, size: file.size, kind, asVoice: kind === "audio" ? true : undefined };

  if (file.size > cap.maxBytes) {
    const mb = Math.round(cap.maxBytes / 1024 / 1024);
    throw new Error(
      cap.blob
        ? `arquivo acima de ${mb} MB.`
        : `arquivo acima de ${mb} MB. Ligue o armazenamento de arquivos (Vercel Blob) no projeto para enviar arquivos grandes.`,
    );
  }

  if (cap.blob) {
    const blob = await upload(`anexos/${safeName(file.name)}`, file, {
      access: "public",
      handleUploadUrl: "/api/upload",
      contentType: mime,
      multipart: file.size > 8 * 1024 * 1024,
      onUploadProgress: (p) => onProgress?.(p.percentage),
    });
    return { ...base, url: blob.url };
  }

  return { ...base, dataUrl: await fileToDataUrl(file) };
}

/** Apaga um arquivo do armazenamento (ignora erros). */
export async function discardAttachment(att: Pick<Attachment, "url">) {
  if (!att.url) return;
  await api(`/api/upload?url=${encodeURIComponent(att.url)}`, { method: "DELETE" }).catch(() => null);
}
