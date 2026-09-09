"use client";

import { FileText, Mic, Play } from "lucide-react";
import { renderWhatsAppText } from "@/lib/wa-format";
import type { AttachmentMeta, MessageDraft } from "@/lib/types";

type PreviewMessage = { text: string; attachments: (AttachmentMeta & { dataUrl?: string })[] };

/** Pré-visualização em estilo de balão do WhatsApp. */
export function MessagePreview({ message }: { message: MessageDraft | PreviewMessage }) {
  const text = message.text.trim();
  const attachments = message.attachments;
  const captionIdx = attachments.findIndex((a) => a.kind !== "audio");
  const empty = !text && attachments.length === 0;
  const now = new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

  const time = (
    <span className="float-right mt-1 ml-3 flex items-center gap-1 text-[10px] text-emerald-100/60">
      {now}
      <svg viewBox="0 0 16 11" className="h-3 w-4 text-sky-300" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
        <path d="M1 6l3 3 6-7" />
        <path d="M6 6l3 3 6-7" />
      </svg>
    </span>
  );

  return (
    <div
      className="relative overflow-hidden rounded-2xl border border-white/10 p-4"
      style={{
        backgroundColor: "#0b141a",
        backgroundImage: "radial-gradient(rgb(255 255 255 / 0.045) 1px, transparent 1px)",
        backgroundSize: "18px 18px",
      }}
    >
      {empty ? (
        <p className="py-10 text-center text-xs text-slate-500">A pré-visualização aparece aqui conforme você escreve.</p>
      ) : (
        <div className="ml-auto flex max-w-[92%] flex-col items-end gap-1.5">
          {attachments.map((att, i) => {
            const url = att.dataUrl;
            const caption = i === captionIdx && text;
            return (
              <div key={att.id} className="w-full max-w-[300px] overflow-hidden rounded-xl rounded-tr-sm bg-[#005c4b] p-1 text-[13px] text-white shadow">
                {att.kind === "image" &&
                  (url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={url} alt="" className="max-h-64 w-full rounded-lg object-cover" />
                  ) : (
                    <div className="flex h-28 items-center justify-center rounded-lg bg-black/20 text-xs text-white/70">{att.name}</div>
                  ))}
                {att.kind === "video" && (
                  <div className="relative">
                    {url ? <video src={url} className="max-h-64 w-full rounded-lg object-cover" muted /> : <div className="flex h-28 items-center justify-center rounded-lg bg-black/20 text-xs text-white/70">{att.name}</div>}
                    <span className="absolute inset-0 flex items-center justify-center">
                      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-black/50">
                        <Play className="h-5 w-5 fill-white text-white" />
                      </span>
                    </span>
                  </div>
                )}
                {att.kind === "audio" && (
                  <div className="flex items-center gap-2 px-2 py-2">
                    <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white/15">{att.asVoice !== false ? <Mic className="h-4 w-4" /> : <Play className="h-4 w-4 fill-white" />}</span>
                    <span className="flex h-1 flex-1 items-center gap-0.5">
                      {Array.from({ length: 28 }).map((_, j) => (
                        <span key={j} className="w-1 rounded-full bg-white/60" style={{ height: 4 + ((j * 7) % 11) }} />
                      ))}
                    </span>
                  </div>
                )}
                {att.kind === "document" && (
                  <div className="flex items-center gap-2 rounded-lg bg-black/20 px-3 py-2">
                    <FileText className="h-5 w-5 shrink-0 text-rose-200" />
                    <span className="truncate">{att.name}</span>
                  </div>
                )}
                {caption ? (
                  <p className="px-2 pt-1.5 pb-1 whitespace-pre-wrap">
                    {renderWhatsAppText(text)}
                    {time}
                  </p>
                ) : (
                  <p className="px-2 pb-0.5 text-right">
                    {time}
                  </p>
                )}
              </div>
            );
          })}
          {text && captionIdx === -1 && (
            <div className="max-w-full rounded-xl rounded-tr-sm bg-[#005c4b] px-3 py-2 text-[13px] whitespace-pre-wrap text-white shadow">
              {renderWhatsAppText(text)}
              {time}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
