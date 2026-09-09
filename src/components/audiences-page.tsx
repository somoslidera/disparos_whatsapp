"use client";

import clsx from "clsx";
import { Layers, Pencil, Plus, Send, Trash2, User, Users } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { api } from "@/lib/client";
import type { SelectionItem } from "@/lib/audiences";
import type { Audience } from "@/lib/types";
import { useData, type AudienceWithTotal } from "./data-provider";
import { RecipientPicker } from "./recipient-picker";
import { SelectionSummary } from "./selection-summary";
import { EmptyState, Modal, PageHeader, Skeleton, Spinner } from "./ui";

const COLORS: Record<string, string> = {
  emerald: "from-emerald-400 to-teal-600",
  sky: "from-sky-400 to-blue-600",
  violet: "from-violet-400 to-fuchsia-600",
  amber: "from-amber-300 to-orange-600",
  rose: "from-rose-400 to-pink-600",
  slate: "from-slate-300 to-slate-600",
};

export function AudiencesPage() {
  const { audiences, loadAudiences } = useData();
  const [editing, setEditing] = useState<Audience | null | "new">(null);
  const [deleting, setDeleting] = useState<AudienceWithTotal | null>(null);

  useEffect(() => {
    if (!audiences.loaded) void loadAudiences();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const remove = async () => {
    if (!deleting) return;
    try {
      await api(`/api/audiences/${deleting.id}`, { method: "DELETE" });
      toast.success("Lista excluída.");
      setDeleting(null);
      void loadAudiences();
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  return (
    <div className="animate-fade-up">
      <PageHeader
        title="Minhas listas"
        subtitle="Agrupe contatos, grupos do WhatsApp e outras listas para disparar de uma vez."
        actions={
          <button type="button" onClick={() => setEditing("new")} className="btn-primary">
            <Plus className="h-4 w-4" /> Nova lista
          </button>
        }
      />

      {audiences.loading && !audiences.loaded ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-40" />
          ))}
        </div>
      ) : audiences.data.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={<Layers className="h-5 w-5" />}
            title="Nenhuma lista ainda"
            description="Crie uma lista com os contatos e grupos que você costuma enviar juntos. Ao selecionar a lista em uma campanha, todos recebem."
            action={
              <button type="button" onClick={() => setEditing("new")} className="btn-primary">
                <Plus className="h-4 w-4" /> Criar primeira lista
              </button>
            }
          />
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {audiences.data.map((a) => {
            const c = a.members.filter((m) => m.type === "contact").length;
            const g = a.members.filter((m) => m.type === "group").length;
            const l = a.members.filter((m) => m.type === "audience").length;
            return (
              <div key={a.id} className="card group flex flex-col p-5 transition hover:border-white/15">
                <div className="flex items-start gap-3">
                  <span className={clsx("flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br text-white shadow-lg", COLORS[a.color] || COLORS.emerald)}>
                    <Layers className="h-5 w-5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <h3 className="truncate font-medium text-white">{a.name}</h3>
                    <p className="line-clamp-2 text-xs text-slate-500">{a.description || "Sem descrição"}</p>
                  </div>
                </div>
                <div className="mt-4 flex items-center gap-3 text-xs text-slate-400">
                  <span className="flex items-center gap-1">
                    <User className="h-3.5 w-3.5 text-brand-300" /> {c}
                  </span>
                  <span className="flex items-center gap-1">
                    <Users className="h-3.5 w-3.5 text-violet-300" /> {g}
                  </span>
                  {l > 0 && (
                    <span className="flex items-center gap-1">
                      <Layers className="h-3.5 w-3.5 text-sky-300" /> {l}
                    </span>
                  )}
                  <span className="ml-auto font-medium text-slate-200 tabular-nums">{a.total} destinatário{a.total === 1 ? "" : "s"}</span>
                </div>
                <div className="mt-4 flex items-center gap-2 border-t border-white/8 pt-3">
                  <button type="button" onClick={() => setEditing(a)} className="btn-secondary h-8 flex-1 px-3 text-xs">
                    <Pencil className="h-3.5 w-3.5" /> Editar
                  </button>
                  <Link href={`/?lista=${a.id}`} className="btn-secondary h-8 flex-1 px-3 text-xs">
                    <Send className="h-3.5 w-3.5" /> Disparar
                  </Link>
                  <button type="button" onClick={() => setDeleting(a)} className="btn-ghost h-8 w-8 p-0 text-slate-500 hover:text-rose-300" title="Excluir">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {editing && (
        <AudienceEditor
          audience={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void loadAudiences();
          }}
        />
      )}

      <Modal
        open={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        title="Excluir lista"
        footer={
          <>
            <button type="button" onClick={() => setDeleting(null)} className="btn-secondary">
              Cancelar
            </button>
            <button type="button" onClick={remove} className="btn-danger">
              <Trash2 className="h-4 w-4" /> Excluir
            </button>
          </>
        }
      >
        <p className="text-sm text-slate-300">
          Excluir a lista <strong className="text-white">{deleting?.name}</strong>? Os contatos e grupos do WhatsApp não são afetados.
        </p>
      </Modal>
    </div>
  );
}

function AudienceEditor({ audience, onClose, onSaved }: { audience: Audience | null; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(audience?.name || "");
  const [description, setDescription] = useState(audience?.description || "");
  const [color, setColor] = useState(audience?.color || "emerald");
  const [members, setMembers] = useState<SelectionItem[]>(audience?.members || []);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!name.trim()) {
      toast.error("Dê um nome à lista.");
      return;
    }
    setSaving(true);
    try {
      const body = JSON.stringify({ name, description, color, members });
      if (audience) await api(`/api/audiences/${audience.id}`, { method: "PUT", body });
      else await api("/api/audiences", { method: "POST", body });
      toast.success(audience ? "Lista atualizada." : "Lista criada.");
      onSaved();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={audience ? "Editar lista" : "Nova lista"}
      description="Uma lista pode conter contatos, grupos do WhatsApp e até outras listas."
      size="xl"
      footer={
        <>
          <button type="button" onClick={onClose} disabled={saving} className="btn-secondary">
            Cancelar
          </button>
          <button type="button" onClick={save} disabled={saving} className="btn-primary">
            {saving && <Spinner />} {audience ? "Salvar alterações" : "Criar lista"}
          </button>
        </>
      }
    >
      <div className="grid gap-5 lg:grid-cols-[300px_1fr]">
        <div className="space-y-4">
          <div>
            <label className="label">Nome</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Clientes VIP" className="input" autoFocus />
          </div>
          <div>
            <label className="label">Descrição</label>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} placeholder="Opcional" className="input resize-none" />
          </div>
          <div>
            <label className="label">Cor</label>
            <div className="flex gap-2">
              {Object.entries(COLORS).map(([key, cls]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setColor(key)}
                  className={clsx("h-7 w-7 rounded-full bg-gradient-to-br ring-offset-2 ring-offset-panel transition", cls, color === key ? "ring-2 ring-white" : "opacity-70 hover:opacity-100")}
                />
              ))}
            </div>
          </div>
          <SelectionSummary value={members} onChange={setMembers} />
        </div>
        <RecipientPicker value={members} onChange={setMembers} excludeAudienceIds={audience ? [audience.id] : []} />
      </div>
    </Modal>
  );
}
