"use client";

import { Plus } from "lucide-react";
import type { MessageBlock, MessageDraft } from "@/lib/types";
import { MessageComposer, newBlock } from "./message-composer";

const MAX_BLOCKS = 10;

/** Editor de mensagem em blocos: cada bloco vira uma mensagem enviada em sequência. */
export function BlocksEditor({ value, onChange, disabled }: { value: MessageDraft; onChange: (next: MessageDraft) => void; disabled?: boolean }) {
  const blocks = value.blocks;

  const update = (i: number, block: MessageBlock) => onChange({ blocks: blocks.map((b, j) => (j === i ? block : b)) });
  const remove = (i: number) => onChange({ blocks: blocks.length === 1 ? [newBlock()] : blocks.filter((_, j) => j !== i) });
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= blocks.length) return;
    const next = [...blocks];
    [next[i], next[j]] = [next[j], next[i]];
    onChange({ blocks: next });
  };
  const add = () => {
    if (blocks.length >= MAX_BLOCKS) return;
    onChange({ blocks: [...blocks, newBlock()] });
  };

  return (
    <div className="space-y-3">
      {blocks.map((b, i) => (
        <MessageComposer
          key={b.id}
          value={b}
          onChange={(nb) => update(i, nb)}
          disabled={disabled}
          index={i}
          total={blocks.length}
          onRemove={() => remove(i)}
          onMoveUp={() => move(i, -1)}
          onMoveDown={() => move(i, 1)}
          autoFocus={i > 0 && i === blocks.length - 1}
        />
      ))}
      <div className="flex items-center gap-3">
        <button type="button" onClick={add} disabled={disabled || blocks.length >= MAX_BLOCKS} className="btn-secondary h-9 px-3 text-xs">
          <Plus className="h-3.5 w-3.5" /> Adicionar bloco
        </button>
        <span className="text-[11px] text-slate-500">Cada bloco é enviado como uma mensagem separada, em sequência, para cada destinatário.</span>
      </div>
    </div>
  );
}
