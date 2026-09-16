"use client";

import clsx from "clsx";
import { AtSign, Bold, ChevronDown, ChevronUp, Code, FileText, Film, Image as ImageIcon, Italic, Mic, Music, Paperclip, Strikethrough, Trash2, UploadCloud } from "lucide-react";
import { nanoid } from "nanoid";
import { useCallback, useEffect, useRef, useState, type DragEvent } from "react";
import { toast } from "sonner";
import { fileToDataUrl, formatBytes } from "@/lib/client";
import { NAME_TAG } from "@/lib/personalize";
import type { Attachment, AttachmentKind, MessageBlock } from "@/lib/types";
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

export function newBlock(): MessageBlock {
  return { id: nanoid(8), text: "", attachments: [] };
}

interface Props {
  value: MessageBlock;
  onChange: (next: MessageBlock) => void;
  disabled?: boolean;
  /** Cabeçalho do bloco (quando há mais de um) */
  index?: number;
  total?: number;
  onRemove?: () => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  autoFocus?: boolean;
}

export function MessageComposer({ value, onChange, disabled, index = 0, total = 1, onRemove, onMoveUp, onMoveDown, autoFocus }: Props) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(0);
  const [dragging, setDragging] = useState(false);
  // Seleção a aplicar depois que o React renderizar o novo texto (inserção pela barra de ferramentas)
  const pendingSelection = useRef<[number, number] | null>(null);

  useEffect(() => {
    const sel = pendingSelection.current;
    const el = textareaRef.current;
    if (!sel || !el) return;
    pendingSelection.current = null;
    el.focus();
    el.setSelectionRange(sel[0], sel[1]);
  }, [value.text]);

  const insertAtCursor = (before: string, after = "", placeholder = "") => {
    const el = textareaRef.current;
    if (!el) return;
    const start = el.selectionStart ?? value.text.length;
    const end = el.selectionEnd ?? start;
    const sel = value.text.slice(start, end) || placeholder;
    const next = value.text.slice(0, start) + before + sel + after + value.text.slice(end);
    pendingSelection.current = [start + before.length, start + before.length + sel.length];
    onChange({ ...value, text: next });
  };

  const wrap = (marker: string) => insertAtCursor(marker, marker, "texto");
  const insertName = () => {
    const el = textareaRef.current;
    const pos = el ? el.selectionStart : value.text.length;
    const before = value.text.slice(0, pos);
    const needsSpace = before.length > 0 && !/\s$/.test(before);
    // Cursor fica depois de {nome}
    const tag = `${needsSpace ? " " : ""}${NAME_TAG}`;
    const next = value.text.slice(0, pos) + tag + value.text.slice(pos);
    pendingSelection.current = [pos + tag.length, pos + tag.length];
    onChange({ ...value, text: next });
  };

  const upload = useCallback(
    async (files: FileList | File[]) => {
      const list = Array.from(files);
      if (!list.length) return;
      if (value.attachments.length + list.length > 10) {
        toast.error("Máximo de 10 anexos por bloco.");
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

  const remove = (att: Attachment) => onChange({ ...value, attachments: value.attachments.filter((a) => a.id !== att.id) });

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    if (disabled) return;
    void upload(e.dataTransfer.files);
  };

  const multi = total > 1;

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

      {multi && (
        <div className="flex items-center gap-2 border-b border-white/8 px-3 py-2">
          <span className="flex h-6 w-6 items-center justify-center rounded-md bg-brand-500/15 text-[11px] font-semibold text-brand-300">{index + 1}</span>
          <span className="text-xs font-medium text-slate-300">Bloco {index + 1} de {total}</span>
          <span className="ml-auto flex items-center gap-0.5">
            <button type="button" onClick={onMoveUp} disabled={disabled || index === 0} className="btn-ghost h-7 w-7 rounded-lg p-0" title="Mover para cima">
              <ChevronUp className="h-4 w-4" />
            </button>
            <button type="button" onClick={onMoveDown} disabled={disabled || index === total - 1} className="btn-ghost h-7 w-7 rounded-lg p-0" title="Mover para baixo">
              <ChevronDown className="h-4 w-4" />
            </button>
            <button type="button" onClick={onRemove} disabled={disabled} className="btn-ghost h-7 w-7 rounded-lg p-0 text-slate-500 hover:text-rose-300" title="Remover bloco">
              <Trash2 className="h-4 w-4" />
            </button>
          </span>
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
        <button type="button" disabled={disabled} onClick={insertName} className="btn-ghost h-8 gap-1.5 rounded-lg px-2 text-xs text-brand-300 hover:text-brand-200" title="Insere o primeiro nome do contato">
          <AtSign className="h-4 w-4" /> Nome
        </button>
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
        autoFocus={autoFocus}
        onChange={(e) => onChange({ ...value, text: e.target.value })}
        placeholder={multi ? "Texto deste bloco…" : "Escreva sua mensagem…\n\nDica: use *negrito*, _itálico_ e ~tachado~ como no WhatsApp. Clique em “Nome” para inserir o primeiro nome do contato."}
        rows={multi ? 4 : 8}
        className={clsx("w-full resize-y bg-transparent px-4 py-3 text-sm leading-relaxed text-slate-100 outline-none placeholder:text-slate-600", multi ? "min-h-[100px]" : "min-h-[180px]")}
      />

      {(value.attachments.length > 0 || uploading > 0) && (
        <div className="border-t border-white/8 p-3">
          <div className="grid gap-2 sm:grid-cols-2">
            {value.attachments.map((att) => (
              <AttachmentCard
                key={att.id}
                att={att}
                disabled={disabled}
                onRemove={() => remove(att)}
                onToggleVoice={(v) => onChange({ ...value, attachments: value.attachments.map((a) => (a.id === att.id ? { ...a, asVoice: v } : a)) })}
              />
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
