import { promises as fs } from "node:fs";
import path from "node:path";
import { nanoid } from "nanoid";
import { UPLOAD_DIR } from "./db";
import type { Attachment, AttachmentKind } from "./types";

export const MAX_UPLOAD_BYTES = 64 * 1024 * 1024; // 64 MB

export function kindFromMime(mime: string, name = ""): AttachmentKind {
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  const ext = path.extname(name).toLowerCase();
  if ([".jpg", ".jpeg", ".png", ".gif", ".webp"].includes(ext)) return "image";
  if ([".mp4", ".mov", ".webm", ".3gp"].includes(ext)) return "video";
  if ([".mp3", ".ogg", ".opus", ".m4a", ".aac", ".wav"].includes(ext)) return "audio";
  return "document";
}

function safeExt(name: string, mime: string): string {
  const ext = path.extname(name).toLowerCase().replace(/[^a-z0-9.]/g, "");
  if (ext && ext.length <= 8) return ext;
  const map: Record<string, string> = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif",
    "video/mp4": ".mp4",
    "audio/mpeg": ".mp3",
    "audio/ogg": ".ogg",
    "audio/mp4": ".m4a",
    "application/pdf": ".pdf",
  };
  return map[mime] || "";
}

export async function saveUpload(file: File): Promise<Attachment> {
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new Error(`Arquivo muito grande (máximo ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MB).`);
  }
  await fs.mkdir(UPLOAD_DIR, { recursive: true });
  const mime = file.type || "application/octet-stream";
  const id = `${nanoid(12)}${safeExt(file.name, mime)}`;
  const buffer = Buffer.from(await file.arrayBuffer());
  await fs.writeFile(path.join(/*turbopackIgnore: true*/ UPLOAD_DIR, id), buffer);
  const kind = kindFromMime(mime, file.name);
  return {
    uploadId: id,
    name: file.name || id,
    mime,
    size: file.size,
    kind,
    asVoice: kind === "audio" ? true : undefined,
  };
}

function resolveUploadPath(uploadId: string): string {
  const base = path.basename(uploadId);
  if (!base || base !== uploadId || base.startsWith(".")) throw new Error("Anexo inválido.");
  return path.join(/*turbopackIgnore: true*/ UPLOAD_DIR, base);
}

export async function readUploadAsDataUri(uploadId: string, mime: string): Promise<string> {
  const buf = await fs.readFile(resolveUploadPath(uploadId));
  return `data:${mime};base64,${buf.toString("base64")}`;
}

export async function readUpload(uploadId: string): Promise<Buffer> {
  return fs.readFile(resolveUploadPath(uploadId));
}

export async function deleteUpload(uploadId: string): Promise<void> {
  try {
    await fs.unlink(resolveUploadPath(uploadId));
  } catch {
    /* ignore */
  }
}
