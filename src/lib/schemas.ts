import { z } from "zod";

export const memberSchema = z.object({
  type: z.enum(["contact", "group", "audience"]),
  id: z.string().min(1),
  name: z.string().default(""),
});

export const audienceInputSchema = z.object({
  name: z.string().trim().min(1, "Informe um nome para a lista").max(80),
  description: z.string().trim().max(300).optional().default(""),
  color: z.string().trim().max(32).optional().default("emerald"),
  members: z.array(memberSchema).default([]),
});

export const attachmentSchema = z.object({
  uploadId: z.string().min(1),
  name: z.string(),
  mime: z.string(),
  size: z.number().nonnegative(),
  kind: z.enum(["image", "video", "audio", "document"]),
  asVoice: z.boolean().optional(),
});

export const campaignInputSchema = z.object({
  name: z.string().trim().max(120).optional().default(""),
  message: z.object({
    text: z.string().max(10_000).default(""),
    attachments: z.array(attachmentSchema).max(10).default([]),
  }),
  selection: z.array(memberSchema).min(1, "Selecione pelo menos um destinatário"),
  settings: z
    .object({
      delayMinSeconds: z.number().min(0).max(600).default(4),
      delayMaxSeconds: z.number().min(0).max(600).default(10),
    })
    .default({ delayMinSeconds: 4, delayMaxSeconds: 10 }),
});

export const testSendSchema = z.object({
  number: z.string().trim().min(8),
  message: z.object({
    text: z.string().max(10_000).default(""),
    attachments: z.array(attachmentSchema).max(10).default([]),
  }),
});
