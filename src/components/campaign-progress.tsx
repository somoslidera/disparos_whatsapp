"use client";

import clsx from "clsx";
import { CheckCircle2, Circle, Loader2, User, Users, XCircle } from "lucide-react";
import { useCallback, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { formatDate } from "@/lib/client";
import { cancelCampaign, isRunning, subscribeRunning } from "@/lib/campaign-client";
import { getCampaign, subscribe as subscribeStore } from "@/lib/store";
import type { Campaign, CampaignRecipient } from "@/lib/types";
import { Badge } from "./ui";

const noop = () => undefined;
const notRunning = () => false;

export function useCampaign(id: string | null) {
  const getSnap = useCallback(() => (id ? getCampaign(id) : undefined), [id]);
  const campaign = useSyncExternalStore(subscribeStore, getSnap, noop);
  const getRun = useCallback(() => (id ? isRunning(id) : false), [id]);
  const running = useSyncExternalStore(subscribeRunning, getRun, notRunning);
  return { campaign: campaign ?? null, running };
}

export function statusTone(status: Campaign["status"]) {
  return ({ queued: "info", running: "brand", completed: "success", cancelled: "warning", failed: "danger" } as const)[status];
}

export function statusLabel(status: Campaign["status"]) {
  return { queued: "Na fila", running: "Enviando", completed: "Concluída", cancelled: "Cancelada", failed: "Falhou" }[status];
}

export function counts(recipients: CampaignRecipient[]) {
  const c = { total: recipients.length, sent: 0, failed: 0, pending: 0, cancelled: 0 };
  for (const r of recipients) {
    if (r.status === "sent") c.sent++;
    else if (r.status === "failed") c.failed++;
    else if (r.status === "cancelled") c.cancelled++;
    else c.pending++;
  }
  return c;
}

export function ProgressBar({ recipients }: { recipients: CampaignRecipient[] }) {
  const c = counts(recipients);
  const pct = (n: number) => (c.total ? (n / c.total) * 100 : 0);
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-white/[0.06]">
      <div className="flex h-full">
        <div className="h-full bg-brand-500 transition-all" style={{ width: `${pct(c.sent)}%` }} />
        <div className="h-full bg-rose-500 transition-all" style={{ width: `${pct(c.failed)}%` }} />
        <div className="h-full bg-amber-500/70 transition-all" style={{ width: `${pct(c.cancelled)}%` }} />
      </div>
    </div>
  );
}

export function CampaignProgress({ campaign, running }: { campaign: Campaign; running: boolean }) {
  const c = counts(campaign.recipients);
  const [cancelling, setCancelling] = useState(false);
  const done = c.sent + c.failed + c.cancelled;

  const cancel = () => {
    setCancelling(true);
    if (cancelCampaign(campaign.id)) toast.success("Cancelamento solicitado. O envio atual será concluído.");
    else toast.error("Esta campanha não está em execução.");
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          {running && <Loader2 className="h-4 w-4 animate-spin text-brand-400" />}
          <Badge tone={statusTone(campaign.status)}>{statusLabel(campaign.status)}</Badge>
          <span className="text-xs text-slate-500">
            {done}/{c.total} processados
          </span>
        </div>
        {running && (
          <button type="button" onClick={cancel} disabled={cancelling} className="btn-danger h-8 px-3 text-xs">
            <XCircle className="h-3.5 w-3.5" /> Cancelar envio
          </button>
        )}
      </div>

      {running && <p className="rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-100">Mantenha esta aba aberta até o fim do disparo.</p>}

      <ProgressBar recipients={campaign.recipients} />

      <div className="grid grid-cols-3 gap-2 text-center">
        <Stat label="Enviadas" value={c.sent} tone="text-brand-300" />
        <Stat label="Falhas" value={c.failed} tone="text-rose-300" />
        <Stat label="Pendentes" value={c.pending + c.cancelled} tone="text-slate-300" />
      </div>

      <ul className="max-h-80 divide-y divide-white/5 overflow-y-auto rounded-xl border border-white/8">
        {campaign.recipients.map((r) => (
          <li key={r.id} className={clsx("flex items-center gap-3 px-3 py-2 text-sm", r.status === "sending" && "bg-brand-500/5")}>
            <StatusIcon status={r.status} />
            {r.type === "group" ? <Users className="h-3.5 w-3.5 shrink-0 text-violet-300" /> : <User className="h-3.5 w-3.5 shrink-0 text-brand-300" />}
            <span className="min-w-0 flex-1">
              <span className="block truncate text-slate-100">{r.name}</span>
              {r.error && <span className="block truncate text-[11px] text-rose-300">{r.error}</span>}
            </span>
            {r.sentAt && <span className="text-[11px] text-slate-500 tabular-nums">{formatDate(r.sentAt)}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className="rounded-xl border border-white/8 bg-white/[0.03] px-3 py-2.5">
      <p className={clsx("text-xl font-semibold tabular-nums", tone)}>{value}</p>
      <p className="text-[11px] text-slate-500">{label}</p>
    </div>
  );
}

function StatusIcon({ status }: { status: CampaignRecipient["status"] }) {
  if (status === "sent") return <CheckCircle2 className="h-4 w-4 shrink-0 text-brand-400" />;
  if (status === "failed") return <XCircle className="h-4 w-4 shrink-0 text-rose-400" />;
  if (status === "sending") return <Loader2 className="h-4 w-4 shrink-0 animate-spin text-brand-300" />;
  if (status === "cancelled") return <Circle className="h-4 w-4 shrink-0 text-amber-400/70" />;
  return <Circle className="h-4 w-4 shrink-0 text-slate-600" />;
}
