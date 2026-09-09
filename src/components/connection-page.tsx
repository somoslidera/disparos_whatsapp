"use client";

import { CheckCircle2, Eye, EyeOff, KeyRound, LogOut, Pencil, QrCode, RefreshCw, Save, Smartphone, Wifi, WifiOff } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { api } from "@/lib/client";
import { formatPhone } from "@/lib/phone";
import { saveSettings } from "@/lib/settings";
import type { InstanceStatus } from "@/lib/types";
import { useData } from "./data-provider";
import { Avatar, Badge, Modal, PageHeader, Spinner } from "./ui";

function SettingsCard() {
  const { settings, status, refreshStatus } = useData();
  const configured = Boolean(settings?.url && settings?.token) || Boolean(status?.envConfigured);
  const [editing, setEditing] = useState(false);
  const [url, setUrl] = useState(settings?.url || "");
  const [token, setToken] = useState(settings?.token || "");
  const [show, setShow] = useState(false);
  const [saving, setSaving] = useState(false);
  const open = editing || !configured;

  const save = async () => {
    const u = url.trim().replace(/\/+$/, "");
    const t = token.trim();
    if (!/^https?:\/\/.+/i.test(u)) {
      toast.error("Informe a URL completa do servidor, ex.: https://seu-servidor.uazapi.com");
      return;
    }
    if (t.length < 8) {
      toast.error("Informe o token da instância.");
      return;
    }
    setSaving(true);
    saveSettings({ url: u, token: t });
    try {
      const s = await api<InstanceStatus>("/api/instance/status");
      toast.success(s.connected ? "Configuração salva. WhatsApp conectado!" : "Configuração salva. Agora conecte o WhatsApp.");
      setEditing(false);
    } catch (err) {
      toast.error(`O uazapi não respondeu: ${(err as Error).message}`);
    } finally {
      setSaving(false);
      void refreshStatus();
    }
  };

  return (
    <div className="card mb-6 p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/[0.05] text-slate-300">
            <KeyRound className="h-5 w-5" />
          </span>
          <div>
            <h2 className="font-semibold text-white">Servidor uazapi</h2>
            <p className="text-xs text-slate-500">
              {configured && !open ? `${settings?.url || "Configurado no servidor"} · token salvo neste navegador` : "Cole a URL do servidor e o token da instância (painel do uazapi)."}
            </p>
          </div>
        </div>
        {configured && !open && (
          <button type="button" onClick={() => setEditing(true)} className="btn-secondary h-8 px-3 text-xs">
            <Pencil className="h-3.5 w-3.5" /> Alterar
          </button>
        )}
      </div>
      {open && (
        <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
          <div>
            <label className="label">Server URL</label>
            <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://seu-servidor.uazapi.com" className="input" autoFocus />
          </div>
          <div>
            <label className="label">Instance Token</label>
            <div className="relative">
              <input type={show ? "text" : "password"} value={token} onChange={(e) => setToken(e.target.value)} placeholder="token da instância" className="input pr-10" />
              <button type="button" onClick={() => setShow((v) => !v)} className="absolute top-1/2 right-2 -translate-y-1/2 rounded-md p-1 text-slate-500 hover:text-white">
                {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>
          <div className="flex items-end gap-2">
            {configured && (
              <button type="button" onClick={() => setEditing(false)} className="btn-secondary">
                Cancelar
              </button>
            )}
            <button type="button" onClick={save} disabled={saving} className="btn-primary">
              {saving ? <Spinner /> : <Save className="h-4 w-4" />} Salvar
            </button>
          </div>
          <p className="text-[11px] leading-relaxed text-slate-500 sm:col-span-3">
            O token fica salvo apenas neste navegador e é usado para o app falar com a sua instância. Nada é armazenado no servidor.
          </p>
        </div>
      )}
    </div>
  );
}

export function ConnectionPage() {
  const { status, statusError, refreshStatus } = useData();
  const [qr, setQr] = useState<InstanceStatus | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [confirmLogout, setConfirmLogout] = useState(false);
  const [phone, setPhone] = useState("");
  const [usePairCode, setUsePairCode] = useState(false);

  const connected = Boolean(status?.connected);

  const connect = async () => {
    setConnecting(true);
    try {
      const res = await api<InstanceStatus>("/api/instance/connect", { method: "POST", body: JSON.stringify(usePairCode && phone ? { phone } : {}) });
      setQr(res);
      if (!res.qrcode && !res.paircode) toast.info("A instância respondeu, mas não retornou QR code. Ela pode já estar conectada.");
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setConnecting(false);
    }
  };

  // Enquanto o QR está aberto: verifica a conexão e renova o código periodicamente
  useEffect(() => {
    if (!qr || connected) return;
    const check = setInterval(() => {
      void api<InstanceStatus & { configured: boolean }>("/api/instance/status")
        .then((s) => {
          if (s.connected) {
            setQr(null);
            toast.success("WhatsApp conectado!");
            void refreshStatus();
          }
        })
        .catch(() => null);
    }, 4000);
    const renew = setInterval(() => void connect(), 40_000);
    return () => {
      clearInterval(check);
      clearInterval(renew);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qr, connected]);

  const logout = async () => {
    try {
      await api("/api/instance/disconnect", { method: "POST" });
      toast.success("Instância desconectada.");
      setConfirmLogout(false);
      await refreshStatus();
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  const qrSrc = qr?.qrcode ? (qr.qrcode.startsWith("data:") ? qr.qrcode : `data:image/png;base64,${qr.qrcode}`) : null;

  return (
    <div className="animate-fade-up">
      <PageHeader
        title="Conexão"
        subtitle="Vincule o seu número do WhatsApp à instância do uazapi."
        actions={
          <button type="button" onClick={() => void refreshStatus()} className="btn-secondary">
            <RefreshCw className="h-4 w-4" /> Atualizar status
          </button>
        }
      />

      <SettingsCard />

      <div className="grid gap-6 lg:grid-cols-[1fr_1fr]">
        <div className="card p-6">
          <div className="flex items-center gap-4">
            <span className={`flex h-14 w-14 items-center justify-center rounded-2xl ${connected ? "bg-brand-500/15 text-brand-300" : "bg-white/[0.05] text-slate-400"}`}>
              {connected ? <Wifi className="h-6 w-6" /> : <WifiOff className="h-6 w-6" />}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <h2 className="font-semibold text-white">{!status ? "Verificando…" : connected ? "Conectado" : status.configured ? "Desconectado" : "Não configurado"}</h2>
                {status && <Badge tone={connected ? "success" : "warning"}>{status.status}</Badge>}
              </div>
              <p className="truncate text-xs text-slate-500">{status?.name ? `Instância: ${status.name}` : status?.configured ? "Instância do uazapi" : "Preencha a configuração acima"}</p>
            </div>
          </div>

          {statusError && status?.configured && <p className="mt-4 rounded-xl border border-rose-500/25 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">{statusError}</p>}

          {connected && (
            <div className="mt-6 flex items-center gap-4 rounded-2xl border border-white/8 bg-white/[0.03] p-4">
              <Avatar name={status?.profileName || status?.phone || "?"} src={status?.profilePicUrl} size={48} />
              <div>
                <p className="font-medium text-white">{status?.profileName || "Número conectado"}</p>
                <p className="text-xs text-slate-400">{status?.phone ? formatPhone(status.phone) : status?.jid}</p>
              </div>
              <CheckCircle2 className="ml-auto h-5 w-5 text-brand-400" />
            </div>
          )}

          <div className="mt-6 flex flex-wrap gap-2">
            {!connected ? (
              <button type="button" onClick={connect} disabled={connecting || !status?.configured} className="btn-primary">
                {connecting ? <Spinner /> : <QrCode className="h-4 w-4" />} Gerar QR code
              </button>
            ) : (
              <button type="button" onClick={() => setConfirmLogout(true)} className="btn-danger">
                <LogOut className="h-4 w-4" /> Desconectar
              </button>
            )}
          </div>

          {!connected && (
            <div className="mt-6 border-t border-white/8 pt-4">
              <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-300">
                <input type="checkbox" checked={usePairCode} onChange={(e) => setUsePairCode(e.target.checked)} className="accent-emerald-500" />
                Conectar por código (sem câmera)
              </label>
              {usePairCode && (
                <div className="mt-3 flex gap-2">
                  <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Seu número com DDI e DDD" className="input" />
                </div>
              )}
            </div>
          )}
        </div>

        <div className="card flex flex-col items-center justify-center p-6 text-center">
          {connected ? (
            <>
              <CheckCircle2 className="mb-3 h-10 w-10 text-brand-400" />
              <p className="font-medium text-white">Tudo pronto para disparar</p>
              <p className="mt-1 max-w-xs text-xs text-slate-500">Seu WhatsApp está vinculado. Os contatos e grupos são carregados diretamente da sua conta.</p>
            </>
          ) : qrSrc ? (
            <>
              <div className="rounded-2xl bg-white p-3 shadow-glow">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={qrSrc} alt="QR code para conectar o WhatsApp" className="h-64 w-64" />
              </div>
              <p className="mt-4 text-sm font-medium text-white">Escaneie com o WhatsApp</p>
              <ol className="mt-2 space-y-1 text-left text-xs text-slate-400">
                <li>1. Abra o WhatsApp no celular</li>
                <li>2. Toque em Configurações → Aparelhos conectados</li>
                <li>3. Toque em Conectar aparelho e aponte para o código</li>
              </ol>
            </>
          ) : qr?.paircode ? (
            <>
              <p className="text-xs text-slate-400">Digite este código no WhatsApp em Aparelhos conectados → Conectar com número de telefone</p>
              <p className="mt-3 font-mono text-4xl font-semibold tracking-[0.3em] text-white">{qr.paircode}</p>
            </>
          ) : (
            <>
              <Smartphone className="mb-3 h-10 w-10 text-slate-600" />
              <p className="text-sm text-slate-300">Clique em “Gerar QR code” para conectar</p>
              <p className="mt-1 max-w-xs text-xs text-slate-500">O código aparece aqui e é renovado automaticamente enquanto a conexão não é concluída.</p>
            </>
          )}
        </div>
      </div>

      <Modal
        open={confirmLogout}
        onClose={() => setConfirmLogout(false)}
        title="Desconectar WhatsApp"
        footer={
          <>
            <button type="button" onClick={() => setConfirmLogout(false)} className="btn-secondary">
              Cancelar
            </button>
            <button type="button" onClick={logout} className="btn-danger">
              <LogOut className="h-4 w-4" /> Desconectar
            </button>
          </>
        }
      >
        <p className="text-sm text-slate-300">Será necessário escanear o QR code novamente para voltar a disparar.</p>
      </Modal>
    </div>
  );
}
