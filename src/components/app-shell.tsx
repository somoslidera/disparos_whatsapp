"use client";

import clsx from "clsx";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { CalendarClock, History, Menu, QrCode, Send, Users, X } from "lucide-react";
import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { resumeScheduled } from "@/lib/campaign-client";
import { getCampaigns, getServerCampaigns, subscribe as subscribeStore } from "@/lib/store";
import { useData } from "./data-provider";

/** Rearma agendamentos ao abrir o app e mostra um aviso enquanto houver disparo agendado. */
function ScheduledBanner() {
  const campaigns = useSyncExternalStore(subscribeStore, getCampaigns, getServerCampaigns);
  useEffect(() => {
    const t = setTimeout(() => resumeScheduled(), 0);
    return () => clearTimeout(t);
  }, []);
  const scheduled = campaigns.filter((c) => c.status === "scheduled" && c.scheduledFor).sort((a, b) => (a.scheduledFor! < b.scheduledFor! ? -1 : 1));
  if (scheduled.length === 0) return null;
  const next = scheduled[0];
  const when = new Date(next.scheduledFor!).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  return (
    <Link href={`/historico/${next.id}`} className="mb-5 flex items-center gap-3 rounded-xl border border-sky-500/25 bg-sky-500/10 px-4 py-2.5 text-sm text-sky-100 transition hover:bg-sky-500/15">
      <CalendarClock className="h-4 w-4 shrink-0 text-sky-300" />
      <span className="min-w-0 flex-1 truncate">
        {scheduled.length === 1 ? `Disparo agendado para ${when}` : `${scheduled.length} disparos agendados · próximo em ${when}`} · mantenha esta aba aberta
      </span>
      <span className="text-xs text-sky-300">Ver</span>
    </Link>
  );
}

const NAV = [
  { href: "/", label: "Nova campanha", icon: Send },
  { href: "/listas", label: "Minhas listas", icon: Users },
  { href: "/historico", label: "Histórico", icon: History },
  { href: "/conexao", label: "Conexão", icon: QrCode },
];

function Logo() {
  return (
    <Link href="/" className="flex items-center gap-3 px-2">
      <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand-300 to-brand-600 shadow-[0_8px_24px_-8px_rgb(16_185_129/0.8)]">
        <Send className="h-4 w-4 text-emerald-950" strokeWidth={2.5} />
      </span>
      <span className="leading-tight">
        <span className="block text-sm font-semibold tracking-tight text-white">Disparos</span>
        <span className="block text-[11px] text-slate-500">WhatsApp · Somos Lidera</span>
      </span>
    </Link>
  );
}

export function ConnectionPill({ compact = false }: { compact?: boolean }) {
  const { status, statusError } = useData();
  const connected = Boolean(status?.connected);
  const label = !status ? "Verificando…" : !status.configured ? "Configurar uazapi" : connected ? "Conectado" : statusError ? "Sem resposta" : "Desconectado";
  return (
    <Link
      href="/conexao"
      className={clsx(
        "flex items-center gap-2.5 rounded-xl border px-3 py-2 text-xs transition",
        connected ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-200" : "border-white/10 bg-white/[0.04] text-slate-300 hover:bg-white/[0.07]",
      )}
      title={status?.phone ? `+${status.phone}` : undefined}
    >
      <span className="relative flex h-2 w-2">
        {connected && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />}
        <span className={clsx("relative inline-flex h-2 w-2 rounded-full", connected ? "bg-emerald-400" : status ? "bg-rose-400" : "bg-slate-500")} />
      </span>
      {!compact && (
        <span className="min-w-0 flex-1 truncate">
          <span className="block font-medium">{label}</span>
          {connected && status && (status.profileName || status.phone) && (
            <span className="block truncate text-[11px] opacity-70">{status.profileName || `+${status.phone}`}</span>
          )}
        </span>
      )}
    </Link>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  if (pathname.startsWith("/login")) return <>{children}</>;

  const nav = (
    <nav className="flex flex-col gap-1">
      {NAV.map((item) => {
        const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={() => setOpen(false)}
            className={clsx(
              "group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition",
              active ? "bg-white/[0.08] font-medium text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.06)]" : "text-slate-400 hover:bg-white/[0.05] hover:text-slate-100",
            )}
          >
            <item.icon className={clsx("h-4 w-4", active ? "text-brand-400" : "text-slate-500 group-hover:text-slate-300")} />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );

  return (
    <div className="flex min-h-screen">
      {/* Sidebar desktop */}
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-white/8 bg-black/20 p-4 backdrop-blur-xl lg:flex">
        <div className="py-2">
          <Logo />
        </div>
        <div className="mt-6 flex-1">{nav}</div>
        <ConnectionPill />
      </aside>

      {/* Sidebar mobile */}
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/60" onClick={() => setOpen(false)} />
          <aside className="animate-fade-up absolute inset-y-0 left-0 flex w-72 flex-col border-r border-white/10 bg-panel p-4">
            <div className="flex items-center justify-between py-2">
              <Logo />
              <button type="button" onClick={() => setOpen(false)} className="btn-ghost h-8 w-8 p-0">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="mt-6 flex-1">{nav}</div>
            <ConnectionPill />
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex items-center justify-between border-b border-white/8 bg-bg/70 px-4 py-3 backdrop-blur-xl lg:hidden">
          <button type="button" onClick={() => setOpen(true)} className="btn-ghost h-9 w-9 p-0">
            <Menu className="h-5 w-5" />
          </button>
          <Logo />
          <ConnectionPill compact />
        </header>
        <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          <ScheduledBanner />
          {children}
        </main>
      </div>
    </div>
  );
}
