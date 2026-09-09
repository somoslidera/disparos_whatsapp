"use client";

import clsx from "clsx";
import { Bold, Code, FileText, Film, Image as ImageIcon, Italic, Mic, Music, Paperclip, Strikethrough, Trash2, UploadCloud } from "lucide-react";
import { useCallback, useRef, useState, type DragEvent } from "react";
import { toast } from "sonner";
import { nanoid } from "nanoid";
import { fileToDataUrl, formatBytes } from "@/lib/client";
import type { Attachment, AttachmentKind, MessageDraft } from "@/lib/types";
import { Spinner, Toggle } from "./ui";

const ACCEPT = "image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.zip";
/** Limite por arquivo. Na Vercel o corpo da requisição é limitado a 4,5 MB (o base64 cresce ~33%). */
export const MAX_ATTACHMENT_BYTES = 3 * 1024 * 1024;

function kindFromMime(mime: string, name: string): AttachmentKind {
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  const ext = name.toLowerCase().split(".").pop() || "";
  if (["jpg", "jpeg", "png", "gif", "webp"].includes(ext)) return "image";
  if (["mp4", "mov", "webm", "3gp"].includes(ext)) return "video";
  if (["mp3", "ogg", "opus", "m4a", "aac", "wav"].includes(ext)) return "audio";
  return "document";
}

export function MessageComposer({ value, onChange, disabled }: { value: MessageDraft; onChange: (next: MessageDraft) => void; disabled?: boolean }) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(0);
  const [dragging, setDragging] = useState(false);

  const wrap = (marker: string) => {
    const el = textareaRef.current;
    if (!el) return;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const sel = value.text.slice(start, end) || "texto";
    const next = value.text.slice(0, start) + marker + sel + marker + value.text.slice(end);
    onChange({ ...value, text: next });
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + marker.length, start + marker.length + sel.length);
    });
  };

  const upload = useCallback(
    async (files: FileList | File[]) => {
      const list = Array.from(files);
      if (!list.length) return;
      if (value.attachments.length + list.length > 10) {
        toast.error("Máximo de 10 anexos por mensagem.");
        return;
      }
      setUploading((n) => n + list.length);
      const added: Attachment[] = [];
      for (const file of list) {
        try {
          if (file.size > MAX_ATTACHMENT_BYTES) {
            throw new Error(`arquivo acima de ${Math.round(MAX_ATTACHMENT_BYTES / 1024 / 1024)} MB. Reduza o tamanho ou use um link.`);
          }
          const mime = file.type || "application/octet-stream";
          const kind = kindFromMime(mime, file.name);
          added.push({
            id: nanoid(10),
            name: file.name,
            mime,
            size: file.size,
            kind,
            asVoice: kind === "audio" ? true : undefined,
            dataUrl: await fileToDataUrl(file),
          });
        } catch (err) {
          toast.error(`Não foi possível anexar ${file.name}: ${(err as Error).message}`);
        } finally {
          setUploading((n) => n - 1);
        }
      }
      if (added.length) onChange({ ...value, attachments: [...value.attachments, ...added] });
    },
    [onChange, value],
  );

  const remove = (att: Attachment) => {
    onChange({ ...value, attachments: value.attachments.filter((a) => a.id !== att.id) });
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    if (disabled) return;
    void upload(e.dataTransfer.files);
  };

  return (
    <div
      className={clsx("card relative flex flex-col transition", dragging && "ring-4 ring-brand-500/20 border-brand-400/50")}
      onDragOver={(e) => {
        e.preventDefault();
        if (!disabled) setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
    >
      {dragging && (
        <div className="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center rounded-2xl bg-bg/80 text-brand-300 backdrop-blur-sm">
          <UploadCloud className="mb-2 h-8 w-8" />
          <span className="text-sm font-medium">Solte para anexar</span>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-1 border-b border-white/8 px-3 py-2">
        {[
          { icon: Bold, marker: "*", title: "Negrito" },
          { icon: Italic, marker: "_", title: "Itálico" },
          { icon: Strikethrough, marker: "~", title: "Tachado" },
          { icon: Code, marker: "```", title: "Monoespaçado" },
        ].map((b) => (
          <button key={b.marker} type="button" title={b.title} disabled={disabled} onClick={() => wrap(b.marker)} className="btn-ghost h-8 w-8 rounded-lg p-0">
            <b.icon className="h-4 w-4" />
          </button>
        ))}
        <span className="mx-1 h-5 w-px bg-white/10" />
        <button type="button" disabled={disabled} onClick={() => fileRef.current?.click()} className="btn-ghost h-8 gap-1.5 rounded-lg px-2 text-xs">
          <Paperclip className="h-4 w-4" /> Anexar
        </button>
        <input ref={fileRef} type="file" multiple accept={ACCEPT} className="hidden" onChange={(e) => e.target.files && (void upload(e.target.files), (e.target.value = ""))} />
        <span className="ml-auto text-[11px] text-slate-500 tabular-nums">{value.text.length.toLocaleString("pt-BR")} caracteres</span>
      </div>

      <textarea
        ref={textareaRef}
        value={value.text}
        disabled={disabled}
        onChange={(e) => onChange({ ...value, text: e.target.value })}
        placeholder={"Escreva sua mensagem…\n\nDica: use *negrito*, _itálico_ e ~tachado~ como no WhatsApp."}
        rows={8}
        className="min-h-[180px] w-full resize-y bg-transparent px-4 py-3 text-sm leading-relaxed text-slate-100 outline-none placeholder:text-slate-600"
      />

      {(value.attachments.length > 0 || uploading > 0) && (
        <div className="border-t border-white/8 p-3">
          <div className="grid gap-2 sm:grid-cols-2">
            {value.attachments.map((att) => (
              <AttachmentCard key={att.id} att={att} disabled={disabled} onRemove={() => remove(att)} onToggleVoice={(v) => onChange({ ...value, attachments: value.attachments.map((a) => (a.id === att.id ? { ...a, asVoice: v } : a)) })} />
            ))}
            {uploading > 0 && (
              <div className="flex items-center gap-3 rounded-xl border border-dashed border-white/15 px-3 py-3 text-xs text-slate-400">
                <Spinner /> Lendo {uploading} arquivo{uploading > 1 ? "s" : ""}…
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function AttachmentCard({ att, onRemove, onToggleVoice, disabled }: { att: Attachment; onRemove: () => void; onToggleVoice: (v: boolean) => void; disabled?: boolean }) {
  const url = att.dataUrl;
  const Icon = att.kind === "image" ? ImageIcon : att.kind === "video" ? Film : att.kind === "audio" ? Music : FileText;
  return (
    <div className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-2 pr-2.5">
      <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-black/30 text-slate-400">
        {att.kind === "image" ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt="" className="h-full w-full object-cover" />
        ) : att.kind === "video" ? (
          <video src={url} className="h-full w-full object-cover" muted />
        ) : (
          <Icon className="h-5 w-5" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-medium text-slate-100">{att.name}</p>
        <p className="text-[11px] text-slate-500">
          {labelFor(att.kind)} · {formatBytes(att.size)}
        </p>
        {att.kind === "audio" && (
          <div className="mt-1.5">
            <Toggle checked={att.asVoice !== false} onChange={onToggleVoice} label={att.asVoice !== false ? "Mensagem de voz" : "Arquivo de áudio"} />
          </div>
        )}
      </div>
      <button type="button" disabled={disabled} onClick={onRemove} className="btn-ghost h-8 w-8 rounded-lg p-0 text-slate-500 hover:text-rose-300" title="Remover">
        <Trash2 className="h-4 w-4" />
      </button>
    </div>
  );
}

export function labelFor(kind: Attachment["kind"]) {
  return { image: "Imagem", video: "Vídeo", audio: "Áudio", document: "Documento" }[kind];
}

export function AttachmentIcon({ kind, className }: { kind: Attachment["kind"]; className?: string }) {
  const Icon = kind === "image" ? ImageIcon : kind === "video" ? Film : kind === "audio" ? Mic : FileText;
  return <Icon className={className} />;
}
