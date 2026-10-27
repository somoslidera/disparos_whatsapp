"use client";

import { Bot, CalendarClock, History, Layers, Paperclip, Trash2, User, Users } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { api, formatDate } from "@/lib/client";
import type { AgentRecord } from "@/lib/agent-store";
import { isRunning } from "@/lib/campaign-client";
import { deleteCampaign, getCampaigns, getServerCampaigns, subscribe as subscribeStore } from "@/lib/store";
import type { Campaign } from "@/lib/types";
import { counts, statusLabel, statusTone } from "./campaign-progress";
import { Badge, EmptyState, Modal, PageHeader } from "./ui";

type Summary = Campaign & { counts: ReturnType<typeof counts> };

const attachmentCount = (c: Campaign) => c.message.blocks.reduce((n, b) => n + b.attachments.length, 0);

const AGENT_STATUS: Record<AgentRecord["status"], { label: string; tone: "info" | "brand" | "success" | "warning" | "danger" | "neutral" }> = {
  enviando: { label: "Enviando", tone: "brand" },
  concluido: { label: "Concluído", tone: "success" },
  parcial: { label: "Parcial", tone: "warning" },
  falha: { label: "Falhou", tone: "danger" },
  duplicado: { label: "Duplicado (não enviado)", tone: "warning" },
  teste: { label: "Teste", tone: "info" },
  teste_falha: { label: "Teste falhou", tone: "danger" },
};

/** Envios feitos pelo agente (gravados no servidor). */
function AgentHistory() {
  const [items, setItems] = useState<AgentRecord[] | null>(null);
  const [open, setOpen] = useState<AgentRecord | null>(null);
  useEffect(() => {
    const t = setTimeout(() => {
      void api<{ envios: AgentRecord[]; disponivel: boolean }>("/api/agente/historico")
        .then((r) => setItems(r.disponivel ? r.envios : []))
        .catch(() => setItems([]));
    }, 0);
    return () => clearTimeout(t);
  }, []);
  if (!items || items.length === 0) return null;
  return (
    <section className="mb-8">
      <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-200">
        <Bot className="h-4 w-4 text-sky-300" /> Envios do agente
        <span className="text-xs font-normal text-slate-500">gravados no servidor</span>
      </h2>
      <div className="space-y-2">
        {items.map((r) => {
          const st = AGENT_STATUS[r.status] || { label: r.status, tone: "neutral" as const };
          return (
            <button key={r.id} type="button" onClick={() => setOpen(r)} className="card flex w-full flex-col gap-1 p-4 text-left transition hover:border-white/15 sm:flex-row sm:items-center sm:gap-4">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone="info">
                    <Bot className="h-3 w-3" /> Agente
                  </Badge>
                  <h3 className="truncate font-medium text-white">{r.grupo}</h3>
                  <Badge tone={st.tone}>{st.label}</Badge>
                  {r.teste && <Badge>teste</Badge>}
                </div>
                <p className="mt-1 line-clamp-1 text-xs text-slate-400">{r.textos[0] || "(sem texto)"}</p>
                <p className="mt-1 text-[11px] text-slate-500">
                  {formatDate(r.data)} · ref. {r.referencia} · {r.enviados}/{r.blocos} bloco{r.blocos === 1 ? "" : "s"}
                  {r.erro ? ` · ${r.erro}` : ""}
                </p>
              </div>
            </button>
          );
        })}
      </div>
      <Modal open={Boolean(open)} onClose={() => setOpen(null)} title={open?.grupo || ""} description={open ? `${formatDate(open.data)} · referência ${open.referencia}` : undefined} size="lg">
        {open && (
          <div className="space-y-3">
            {open.textos.map((t, i) => {
              const m = open.mensagens[i];
              return (
                <div key={i} className="rounded-xl border border-white/8 bg-white/[0.03] p-3">
                  <div className="mb-1 flex items-center gap-2 text-[11px] text-slate-500">
                    Bloco {i + 1}
                    {m && <Badge tone={m.status === "falha" || m.status === "nao_enviado" ? "danger" : "success"}>{m.status}</Badge>}
                    {m?.erro && <span className="text-rose-300">{m.erro}</span>}
                  </div>
                  <p className="text-sm whitespace-pre-wrap text-slate-100">{t}</p>
                </div>
              );
            })}
          </div>
        )}
      </Modal>
    </section>
  );
}

export function HistoryPage() {
  const campaigns = useSyncExternalStore(subscribeStore, getCampaigns, getServerCampaigns);
  const items = useMemo<Summary[]>(() => campaigns.map((c) => ({ ...c, counts: counts(c.recipients) })), [campaigns]);
  const [deleting, setDeleting] = useState<Summary | null>(null);

  const remove = () => {
    if (!deleting) return;
    if (isRunning(deleting.id) || deleting.status === "scheduled") {
      toast.error("Cancele a campanha antes de excluí-la.");
      return;
    }
    deleteCampaign(deleting.id);
    setDeleting(null);
  };

  return (
    <div className="animate-fade-up">
      <PageHeader title="Histórico" subtitle="Acompanhe os disparos realizados e o resultado por destinatário. Fica salvo neste navegador." />

      <AgentHistory />

      {items.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={<History className="h-5 w-5" />}
            title="Nenhum disparo ainda"
            description="Quando você disparar uma campanha, ela aparece aqui com o status de cada destinatário."
            action={
              <Link href="/" className="btn-primary">
                Criar campanha
              </Link>
            }
          />
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((c) => {
            const pct = c.counts.total ? Math.round(((c.counts.sent + c.counts.failed + c.counts.cancelled) / c.counts.total) * 100) : 0;
            return (
              <div key={c.id} className="card flex flex-col gap-3 p-4 transition hover:border-white/15 sm:flex-row sm:items-center">
                <Link href={`/historico/${c.id}`} className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="truncate font-medium text-white">{c.name}</h3>
                    <Badge tone={statusTone(c.status)}>{statusLabel(c.status)}</Badge>
                    {c.status === "scheduled" && c.scheduledFor && (
                      <Badge tone="info">
                        <CalendarClock className="h-3 w-3" /> {formatDate(c.scheduledFor)}
                      </Badge>
                    )}
                    {c.message.blocks.length > 1 && <Badge>{c.message.blocks.length} blocos</Badge>}
                    {attachmentCount(c) > 0 && (
                      <Badge>
                        <Paperclip className="h-3 w-3" /> {attachmentCount(c)}
                      </Badge>
                    )}
                  </div>
                  <p className="mt-1 line-clamp-1 text-xs text-slate-400">{c.message.blocks.map((b) => b.text).filter(Boolean).join(" · ") || "(sem texto)"}</p>
                  <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500">
                    <span>{formatDate(c.createdAt)}</span>
                    {c.sources.slice(0, 4).map((s) => (
                      <span key={`${s.type}:${s.id}`} className="flex items-center gap-1">
                        {s.type === "audience" ? <Layers className="h-3 w-3 text-sky-300" /> : s.type === "group" ? <Users className="h-3 w-3 text-violet-300" /> : <User className="h-3 w-3 text-brand-300" />}
                        <span className="max-w-[140px] truncate">{s.name}</span>
                      </span>
                    ))}
                    {c.sources.length > 4 && <span>+{c.sources.length - 4}</span>}
                  </div>
                </Link>
                <div className="flex items-center gap-4 sm:w-64">
                  <div className="flex-1">
                    <div className="mb-1 flex justify-between text-[11px] text-slate-400 tabular-nums">
                      <span className="text-brand-300">{c.counts.sent} enviadas</span>
                      {c.counts.failed > 0 && <span className="text-rose-300">{c.counts.failed} falhas</span>}
                      <span>{pct}%</span>
                    </div>
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/[0.06]">
                      <div className="flex h-full">
                        <div className="bg-brand-500" style={{ width: `${(c.counts.sent / (c.counts.total || 1)) * 100}%` }} />
                        <div className="bg-rose-500" style={{ width: `${(c.counts.failed / (c.counts.total || 1)) * 100}%` }} />
                      </div>
                    </div>
                  </div>
                  <button type="button" onClick={() => setDeleting(c)} disabled={c.status === "running" || c.status === "scheduled"} className="btn-ghost h-8 w-8 p-0 text-slate-500 hover:text-rose-300" title="Excluir do histórico">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Modal
        open={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        title="Excluir do histórico"
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
        <p className="text-sm text-slate-300">Remover o registro da campanha <strong className="text-white">{deleting?.name}</strong>? As mensagens já enviadas não são afetadas.</p>
      </Modal>
    </div>
  );
}
