"use client";

import clsx from "clsx";
import { AlertCircle, Layers, Plus, RefreshCw, User, UserRoundSearch, Users } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { formatPhone, onlyDigits, toContactJid } from "@/lib/phone";
import type { SelectionItem } from "@/lib/audiences";
import type { WaGroup } from "@/lib/types";
import { useData } from "./data-provider";
import { GroupMembersModal } from "./group-members";
import { Avatar, Checkbox, EmptyState, SearchInput, Skeleton, Spinner } from "./ui";

type Tab = "contacts" | "groups" | "audiences";

interface Row {
  type: SelectionItem["type"];
  id: string;
  name: string;
  subtitle: string;
  image?: string | null;
}

export function RecipientPicker({
  value,
  onChange,
  allowAudiences = true,
  excludeAudienceIds = [],
  className,
}: {
  value: SelectionItem[];
  onChange: (next: SelectionItem[]) => void;
  allowAudiences?: boolean;
  excludeAudienceIds?: string[];
  className?: string;
}) {
  const { contacts, groups, audiences, loadContacts, loadGroups, status } = useData();
  const [tab, setTab] = useState<Tab>("contacts");
  const [query, setQuery] = useState("");
  const [manual, setManual] = useState("");
  const [membersOf, setMembersOf] = useState<WaGroup | null>(null);

  useEffect(() => {
    if (!contacts.loaded && !contacts.loading) void loadContacts();
    if (!groups.loaded && !groups.loading) void loadGroups();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selected = useMemo(() => new Set(value.map((v) => `${v.type}:${v.id}`)), [value]);

  const rows: Row[] = useMemo(() => {
    if (tab === "contacts")
      return contacts.data.map((c) => ({ type: "contact", id: c.id, name: c.name, subtitle: formatPhone(c.phone), image: c.image }));
    if (tab === "groups")
      return groups.data.map((g) => ({
        type: "group",
        id: g.id,
        name: g.name,
        subtitle: g.participants ? `${g.participants} participantes` : "Grupo",
        image: g.image,
      }));
    return audiences
      .filter((a) => !excludeAudienceIds.includes(a.id))
      .map((a) => ({ type: "audience", id: a.id, name: a.name, subtitle: `${a.total} destinatário${a.total === 1 ? "" : "s"} · ${a.members.length} itens` }));
  }, [tab, contacts.data, groups.data, audiences, excludeAudienceIds]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const digits = onlyDigits(q);
    if (!q) return rows;
    return rows.filter((r) => r.name.toLowerCase().includes(q) || (digits && onlyDigits(r.subtitle + r.id).includes(digits)));
  }, [rows, query]);

  const localResource = { data: audiences, loading: false, error: null, loaded: true };
  const resource = tab === "contacts" ? contacts : tab === "groups" ? groups : localResource;
  const reload = tab === "contacts" ? () => loadContacts(true) : tab === "groups" ? () => loadGroups(true) : async () => {};

  const toggle = (row: Row) => {
    const key = `${row.type}:${row.id}`;
    if (selected.has(key)) onChange(value.filter((v) => `${v.type}:${v.id}` !== key));
    else onChange([...value, { type: row.type, id: row.id, name: row.name }]);
  };

  const allFilteredSelected = filtered.length > 0 && filtered.every((r) => selected.has(`${r.type}:${r.id}`));
  const someFilteredSelected = filtered.some((r) => selected.has(`${r.type}:${r.id}`));
  const toggleAll = () => {
    if (allFilteredSelected) {
      const keys = new Set(filtered.map((r) => `${r.type}:${r.id}`));
      onChange(value.filter((v) => !keys.has(`${v.type}:${v.id}`)));
    } else {
      const add = filtered.filter((r) => !selected.has(`${r.type}:${r.id}`)).map((r) => ({ type: r.type, id: r.id, name: r.name }));
      onChange([...value, ...add]);
    }
  };

  const addManual = () => {
    const digits = onlyDigits(manual);
    if (digits.length < 10) {
      toast.error("Informe o número com DDI e DDD, ex.: 5511999999999");
      return;
    }
    const id = toContactJid(digits);
    if (selected.has(`contact:${id}`)) {
      toast.info("Este número já está selecionado.");
      return;
    }
    const known = contacts.data.find((c) => c.id === id);
    onChange([...value, { type: "contact", id, name: known?.name || formatPhone(digits) }]);
    setManual("");
  };

  const tabs: { id: Tab; label: string; icon: typeof User; count: number }[] = [
    { id: "contacts", label: "Contatos", icon: User, count: contacts.data.length },
    { id: "groups", label: "Grupos", icon: Users, count: groups.data.length },
    ...(allowAudiences ? [{ id: "audiences" as Tab, label: "Minhas listas", icon: Layers, count: audiences.length }] : []),
  ];

  const selectedInTab = rows.filter((r) => selected.has(`${r.type}:${r.id}`)).length;

  return (
    <div className={clsx("card flex flex-col overflow-hidden", className)}>
      <div className="flex items-center gap-1 border-b border-white/8 p-2">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => {
              setTab(t.id);
              setQuery("");
            }}
            className={clsx(
              "flex flex-1 items-center justify-center gap-2 rounded-xl px-3 py-2 text-sm transition",
              tab === t.id ? "bg-white/[0.08] font-medium text-white" : "text-slate-400 hover:bg-white/[0.04] hover:text-slate-200",
            )}
          >
            <t.icon className={clsx("h-4 w-4", tab === t.id ? "text-brand-400" : "")} />
            <span className="hidden sm:inline">{t.label}</span>
            {t.count > 0 && <span className="rounded-md bg-white/[0.06] px-1.5 py-0.5 text-[10px] text-slate-400 tabular-nums">{t.count}</span>}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-2 border-b border-white/8 p-3">
        <SearchInput value={query} onChange={setQuery} placeholder={tab === "contacts" ? "Buscar por nome ou número…" : "Buscar…"} className="flex-1" />
        <button type="button" onClick={() => void reload()} disabled={resource.loading} className="btn-secondary h-10 w-10 shrink-0 p-0" title="Atualizar">
          {resource.loading ? <Spinner /> : <RefreshCw className="h-4 w-4" />}
        </button>
      </div>

      {tab === "contacts" && (
        <div className="flex items-center gap-2 border-b border-white/8 px-3 py-2">
          <input
            value={manual}
            onChange={(e) => setManual(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addManual())}
            placeholder="Adicionar número manualmente (ex.: 5511999999999)"
            className="input h-9 py-1.5 text-xs"
          />
          <button type="button" onClick={addManual} className="btn-secondary h-9 shrink-0 px-3 text-xs">
            <Plus className="h-3.5 w-3.5" /> Adicionar
          </button>
        </div>
      )}

      <div className="flex items-center justify-between px-3 py-2 text-xs text-slate-400">
        <button type="button" onClick={toggleAll} disabled={filtered.length === 0} className="flex items-center gap-2 rounded-lg px-1.5 py-1 hover:bg-white/[0.05] disabled:opacity-40">
          <Checkbox checked={allFilteredSelected} indeterminate={someFilteredSelected && !allFilteredSelected} />
          {allFilteredSelected ? "Desmarcar" : "Selecionar"} {query ? `${filtered.length} filtrados` : "todos"}
        </button>
        <span className="tabular-nums">
          {selectedInTab} de {rows.length} selecionados
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto" style={{ maxHeight: 460 }}>
        {resource.loading && !resource.loaded ? (
          <div className="space-y-2 p-3">
            {Array.from({ length: 7 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 px-1 py-1.5">
                <Skeleton className="h-9 w-9 rounded-full" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-3 w-1/2" />
                  <Skeleton className="h-2.5 w-1/3" />
                </div>
              </div>
            ))}
          </div>
        ) : resource.error ? (
          <EmptyState
            icon={<AlertCircle className="h-5 w-5 text-rose-400" />}
            title="Não foi possível carregar"
            description={
              status && !status.configured
                ? "Configure a URL e o token do uazapi na aba Conexão."
                : status && !status.connected
                  ? "O WhatsApp não está conectado. Conecte a instância na aba Conexão."
                  : resource.error
            }
            action={
              <button type="button" onClick={() => void reload()} className="btn-secondary text-xs">
                <RefreshCw className="h-3.5 w-3.5" /> Tentar novamente
              </button>
            }
          />
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={tab === "audiences" ? <Layers className="h-5 w-5" /> : <Users className="h-5 w-5" />}
            title={query ? "Nada encontrado" : tab === "audiences" ? "Nenhuma lista criada" : tab === "groups" ? "Nenhum grupo encontrado" : "Nenhum contato encontrado"}
            description={
              query
                ? "Tente outro termo de busca."
                : tab === "audiences"
                  ? "Crie listas em “Minhas listas” para reutilizar conjuntos de contatos e grupos."
                  : "Clique em atualizar para buscar novamente no WhatsApp."
            }
          />
        ) : (
          <ul className="p-2">
            {filtered.map((row) => {
              const isSel = selected.has(`${row.type}:${row.id}`);
              return (
                <li key={`${row.type}:${row.id}`} className="group/row relative">
                  <button
                    type="button"
                    onClick={() => toggle(row)}
                    className={clsx(
                      "flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left transition",
                      row.type === "group" && "pr-24",
                      isSel ? "bg-brand-500/10" : "hover:bg-white/[0.04]",
                    )}
                  >
                    <Checkbox checked={isSel} />
                    {row.type === "audience" ? (
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-sky-500/40 to-violet-500/40 text-sky-100">
                        <Layers className="h-4 w-4" />
                      </span>
                    ) : (
                      <Avatar name={row.name} src={row.image} />
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-slate-100">{row.name}</span>
                      <span className="block truncate text-xs text-slate-500">{row.subtitle}</span>
                    </span>
                  </button>
                  {row.type === "group" && (
                    <button
                      type="button"
                      onClick={() => setMembersOf(groups.data.find((g) => g.id === row.id) || { id: row.id, name: row.name, participants: 0 })}
                      className="btn-secondary absolute top-1/2 right-2 h-8 -translate-y-1/2 gap-1.5 px-2.5 text-xs"
                      title="Enviar no privado dos membros"
                    >
                      <UserRoundSearch className="h-3.5 w-3.5" /> Membros
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {membersOf && <GroupMembersModal group={membersOf} value={value} onChange={onChange} onClose={() => setMembersOf(null)} />}
    </div>
  );
}
