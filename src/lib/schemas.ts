import { z } from "zod";

export const attachmentPayloadSchema = z.object({
  name: z.string().max(255),
  mime: z.string().max(120),
  kind: z.enum(["image", "video", "audio", "document"]),
  asVoice: z.boolean().optional(),
  /** URL pública do arquivo (Vercel Blob) */
  url: z.string().url().optional(),
  /** data URI base64 (modo reserva) */
  dataUrl: z.string().min(1).optional(),
}).refine((a) => Boolean(a.url || a.dataUrl), { message: "Anexo sem conteúdo (url ou dataUrl)." });

export const sendSchema = z.object({
  /** jid (grupo ou contato) ou telefone com DDI */
  to: z.string().trim().min(5),
  text: z.string().max(10_000).default(""),
  attachments: z.array(attachmentPayloadSchema).max(10).default([]),
});

export type SendInput = z.infer<typeof sendSchema>;
