"use client";

import { Layers, User, Users, X } from "lucide-react";
import { useMemo } from "react";
import { resolveRecipients, type SelectionItem } from "@/lib/audiences";
import { useData } from "./data-provider";

export function useResolvedCount(selection: SelectionItem[]) {
  const { audiences } = useData();
  return useMemo(() => {
    const r = resolveRecipients(selection, audiences);
    return { total: r.length, contacts: r.filter((x) => x.type === "contact").length, groups: r.filter((x) => x.type === "group").length };
  }, [selection, audiences]);
}

export function SelectionSummary({ value, onChange }: { value: SelectionItem[]; onChange: (next: SelectionItem[]) => void }) {
  const counts = useResolvedCount(value);
  if (value.length === 0) return null;
  return (
    <div className="card p-3">
      <div className="mb-2 flex items-center justify-between text-xs">
        <span className="text-slate-400">
          <span className="font-semibold text-white tabular-nums">{counts.total}</span> destinatário{counts.total === 1 ? "" : "s"} · {counts.contacts} contato
          {counts.contacts === 1 ? "" : "s"} · {counts.groups} grupo{counts.groups === 1 ? "" : "s"}
        </span>
        <button type="button" onClick={() => onChange([])} className="text-slate-500 hover:text-rose-300">
          Limpar
        </button>
      </div>
      <div className="flex max-h-28 flex-wrap gap-1.5 overflow-y-auto">
        {value.map((v) => (
          <span key={`${v.type}:${v.id}`} className="chip">
            {v.type === "audience" ? <Layers className="h-3 w-3 text-sky-300" /> : v.type === "group" ? <Users className="h-3 w-3 text-violet-300" /> : <User className="h-3 w-3 text-brand-300" />}
            <span className="max-w-[160px] truncate">{v.name}</span>
            <button type="button" onClick={() => onChange(value.filter((x) => !(x.type === v.type && x.id === v.id)))} className="rounded-full p-0.5 text-slate-500 hover:bg-white/10 hover:text-white">
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
      </div>
    </div>
  );
}
