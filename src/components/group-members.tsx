"use client";

import clsx from "clsx";
import { AlertCircle, RefreshCw, ShieldCheck, User, Users } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/client";
import { formatPhone, onlyDigits } from "@/lib/phone";
import type { SelectionItem } from "@/lib/audiences";
import type { WaGroup, WaParticipant } from "@/lib/types";
import { useData } from "./data-provider";
import { Avatar, Checkbox, EmptyState, Modal, SearchInput, Skeleton, Spinner } from "./ui";

/**
 * Janela "Membros do grupo": permite enviar no grupo e/ou no privado de membros escolhidos.
 */
export function GroupMembersModal({
  group,
  value,
  onChange,
  onClose,
}: {
  group: WaGroup;
  value: SelectionItem[];
  onChange: (next: SelectionItem[]) => void;
  onClose: () => void;
}) {
  const { contacts, status } = useData();
  const [participants, setParticipants] = useState<WaParticipant[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [groupSelected, setGroupSelected] = useState(() => value.some((v) => v.type === "group" && v.id === group.id));
  const [picked, setPicked] = useState<Set<string>>(() => new Set(value.filter((v) => v.type === "contact").map((v) => v.id)));
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api<{ participants: WaParticipant[] }>(`/api/whatsapp/groups/participants?jid=${encodeURIComponent(group.id)}`);
      setParticipants(res.participants);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [group.id]);

  const contactNames = useMemo(() => new Map(contacts.data.map((c) => [c.id, c.name])), [contacts.data]);
  const myJid = status?.phone ? `${status.phone}@s.whatsapp.net` : null;

  const rows = useMemo(() => {
    const list = (participants ?? []).map((p) => ({
      ...p,
      isMe: p.id === myJid,
      displayName: contactNames.get(p.id) || p.name || (p.phone ? formatPhone(p.phone) : "Número oculto"),
      subtitle: p.phone ? formatPhone(p.phone) : "WhatsApp não exibe o número",
    }));
    const q = query.trim().toLowerCase();
    const digits = onlyDigits(q);
    if (!q) return list;
    return list.filter((r) => r.displayName.toLowerCase().includes(q) || (digits && r.phone.includes(digits)));
  }, [participants, query, contactNames, myJid]);

  const selectable = rows.filter((r) => !r.isMe);
  const allSelected = selectable.length > 0 && selectable.every((r) => picked.has(r.id));
  const someSelected = selectable.some((r) => picked.has(r.id));

  const toggle = (id: string) => {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    setPicked((prev) => {
      const next = new Set(prev);
      if (allSelected) selectable.forEach((r) => next.delete(r.id));
      else selectable.forEach((r) => next.add(r.id));
      return next;
    });
  };

  const pickedInGroup = (participants ?? []).filter((p) => picked.has(p.id)).length;

  const apply = () => {
    const participantIds = new Set((participants ?? []).map((p) => p.id));
    // Mantém tudo que não diz respeito a este grupo; substitui grupo + membros deste grupo pela escolha atual.
    let next = value.filter((v) => !(v.type === "group" && v.id === group.id) && !(v.type === "contact" && participantIds.has(v.id)));
    if (groupSelected) next = [...next, { type: "group", id: group.id, name: group.name }];
    for (const p of participants ?? []) {
      if (!picked.has(p.id)) continue;
      const name = contactNames.get(p.id) || p.name || (p.phone ? formatPhone(p.phone) : p.id);
      next.push({ type: "contact", id: p.id, name });
    }
    onChange(next);
    onClose();
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={group.name}
      description="Escolha se a mensagem vai para o grupo, para o privado de cada membro, ou para os dois."
      size="lg"
      footer={
        <>
          <span className="mr-auto text-xs text-slate-400 tabular-nums">
            {groupSelected ? "Grupo" : "Sem grupo"} · {pickedInGroup} membro{pickedInGroup === 1 ? "" : "s"} no privado
          </span>
          <button type="button" onClick={onClose} className="btn-secondary">
            Cancelar
          </button>
          <button type="button" onClick={apply} className="btn-primary">
            Aplicar
          </button>
        </>
      }
    >
      <button
        type="button"
        onClick={() => setGroupSelected((v) => !v)}
        className={clsx("mb-4 flex w-full items-center gap-3 rounded-xl border px-3 py-3 text-left transition", groupSelected ? "border-brand-500/40 bg-brand-500/10" : "border-white/10 bg-white/[0.03] hover:bg-white/[0.05]")}
      >
        <Checkbox checked={groupSelected} />
        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-violet-500/20 text-violet-200">
          <Users className="h-4 w-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm text-slate-100">Enviar no grupo</span>
          <span className="block text-xs text-slate-500">Uma mensagem para todos, dentro da conversa do grupo</span>
        </span>
      </button>

      <div className="mb-2 flex items-center gap-2">
        <User className="h-4 w-4 text-brand-300" />
        <span className="text-sm font-medium text-slate-200">Enviar no privado dos membros</span>
        <span className="ml-auto text-xs text-slate-500 tabular-nums">{participants ? `${participants.length} membros` : ""}</span>
      </div>

      <div className="card overflow-hidden">
        <div className="flex items-center gap-2 border-b border-white/8 p-2.5">
          <SearchInput value={query} onChange={setQuery} placeholder="Buscar membro por nome ou número…" className="flex-1" />
          <button type="button" onClick={() => void load()} disabled={loading} className="btn-secondary h-10 w-10 shrink-0 p-0" title="Atualizar">
            {loading ? <Spinner /> : <RefreshCw className="h-4 w-4" />}
          </button>
        </div>
        <div className="flex items-center justify-between px-3 py-2 text-xs text-slate-400">
          <button type="button" onClick={toggleAll} disabled={selectable.length === 0} className="flex items-center gap-2 rounded-lg px-1.5 py-1 hover:bg-white/[0.05] disabled:opacity-40">
            <Checkbox checked={allSelected} indeterminate={someSelected && !allSelected} />
            {allSelected ? "Desmarcar" : "Selecionar"} {query ? `${selectable.length} filtrados` : "todos os membros"}
          </button>
          <span className="tabular-nums">{pickedInGroup} selecionados</span>
        </div>
        <div className="max-h-[340px] overflow-y-auto">
          {loading && !participants ? (
            <div className="space-y-2 p-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3 px-1 py-1.5">
                  <Skeleton className="h-9 w-9 rounded-full" />
                  <div className="flex-1 space-y-1.5">
                    <Skeleton className="h-3 w-1/2" />
                    <Skeleton className="h-2.5 w-1/3" />
                  </div>
                </div>
              ))}
            </div>
          ) : error ? (
            <EmptyState
              icon={<AlertCircle className="h-5 w-5 text-rose-400" />}
              title="Não foi possível carregar os membros"
              description={error}
              action={
                <button type="button" onClick={() => void load()} className="btn-secondary text-xs">
                  <RefreshCw className="h-3.5 w-3.5" /> Tentar novamente
                </button>
              }
            />
          ) : rows.length === 0 ? (
            <EmptyState icon={<Users className="h-5 w-5" />} title={query ? "Nenhum membro encontrado" : "Este grupo não tem membros visíveis"} />
          ) : (
            <ul className="p-2">
              {rows.map((r) => {
                const isSel = picked.has(r.id);
                return (
                  <li key={r.id}>
                    <button
                      type="button"
                      disabled={r.isMe}
                      onClick={() => toggle(r.id)}
                      className={clsx("flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left transition disabled:opacity-50", isSel ? "bg-brand-500/10" : "hover:bg-white/[0.04]")}
                    >
                      <Checkbox checked={isSel} />
                      <Avatar name={r.displayName} />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-1.5 truncate text-sm text-slate-100">
                          {r.displayName}
                          {r.isMe && <span className="text-[11px] text-slate-500">(você)</span>}
                          {r.isAdmin && <ShieldCheck className="h-3.5 w-3.5 text-amber-300" aria-label="Administrador" />}
                        </span>
                        <span className="block truncate text-xs text-slate-500">{r.subtitle}</span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
      <p className="mt-3 text-[11px] leading-relaxed text-slate-500">
        Mensagens no privado têm mais chance de resposta. Envie apenas para quem espera o seu contato: muitos envios a números que não salvaram o seu podem levar a bloqueios.
      </p>
    </Modal>
  );
}
