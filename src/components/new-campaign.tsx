"use client";

import { AlertTriangle, ExternalLink, FlaskConical, Send, Settings2, Timer } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { api } from "@/lib/client";
import type { SelectionItem } from "@/lib/audiences";
import type { Campaign, MessageDraft } from "@/lib/types";
import { CampaignProgress, useCampaign } from "./campaign-progress";
import { useData } from "./data-provider";
import { MessageComposer } from "./message-composer";
import { MessagePreview } from "./message-preview";
import { RecipientPicker } from "./recipient-picker";
import { SelectionSummary, useResolvedCount } from "./selection-summary";
import { Modal, PageHeader, Spinner } from "./ui";

const EMPTY: MessageDraft = { text: "", attachments: [] };

export function NewCampaign() {
  const router = useRouter();
  const { status, audiences, loadAudiences } = useData();
  const params = useSearchParams();
  const [message, setMessage] = useState<MessageDraft>(EMPTY);
  const [selection, setSelection] = useState<SelectionItem[]>([]);
  const [name, setName] = useState("");
  const [delayMin, setDelayMin] = useState(4);
  const [delayMax, setDelayMax] = useState(10);
  const [showSettings, setShowSettings] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [testOpen, setTestOpen] = useState(false);
  const [testNumber, setTestNumber] = useState("");
  const [testing, setTesting] = useState(false);
  const [sending, setSending] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const counts = useResolvedCount(selection);
  const { campaign, running } = useCampaign(activeId);

  // Atalhos: "Reutilizar campanha" (sessionStorage) e "Disparar" a partir de uma lista (?lista=id)
  useEffect(() => {
    let raw: string | null = null;
    try {
      raw = sessionStorage.getItem("disparos:draft");
      if (raw) sessionStorage.removeItem("disparos:draft");
    } catch {
      /* ignore */
    }
    if (!raw) return;
    const draft = JSON.parse(raw) as { message?: MessageDraft; selection?: SelectionItem[] };
    queueMicrotask(() => {
      if (draft.message) setMessage({ text: draft.message.text || "", attachments: draft.message.attachments || [] });
      if (draft.selection) setSelection(draft.selection);
      toast.success("Campanha carregada. Revise antes de disparar.");
    });
  }, []);

  const listaId = params.get("lista");
  useEffect(() => {
    if (!listaId) return;
    if (!audiences.loaded) {
      void loadAudiences();
      return;
    }
    const a = audiences.data.find((x) => x.id === listaId);
    queueMicrotask(() => {
      if (a) setSelection((prev) => (prev.some((p) => p.type === "audience" && p.id === a.id) ? prev : [...prev, { type: "audience", id: a.id, name: a.name }]));
      router.replace("/");
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listaId, audiences.loaded]);

  const hasContent = Boolean(message.text.trim()) || message.attachments.length > 0;
  const canSend = hasContent && counts.total > 0 && !sending;
  const connected = Boolean(status?.connected);
  const avg = (Math.max(delayMin, 0) + Math.max(delayMax, delayMin)) / 2;
  const estimateSec = Math.max(0, counts.total - 1) * avg + counts.total * (1 + message.attachments.length * 2);
  const estimate = estimateSec < 90 ? `~${Math.round(estimateSec)} s` : `~${Math.round(estimateSec / 60)} min`;

  const start = async () => {
    setSending(true);
    try {
      const res = await api<{ campaign: Campaign }>("/api/campaigns", {
        method: "POST",
        body: JSON.stringify({
          name,
          message,
          selection,
          settings: { delayMinSeconds: delayMin, delayMaxSeconds: delayMax },
        }),
      });
      setConfirmOpen(false);
      setActiveId(res.campaign.id);
      toast.success("Disparo iniciado!");
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSending(false);
    }
  };

  const sendTest = async () => {
    setTesting(true);
    try {
      await api("/api/test-send", { method: "POST", body: JSON.stringify({ number: testNumber, message }) });
      toast.success("Mensagem de teste enviada.");
      setTestOpen(false);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setTesting(false);
    }
  };

  const reset = useCallback(() => {
    setActiveId(null);
    setMessage(EMPTY);
    setSelection([]);
    setName("");
  }, []);

  return (
    <div className="animate-fade-up">
      <PageHeader
        title="Nova campanha"
        subtitle="Escreva a mensagem, escolha para quem enviar e dispare."
        actions={
          <>
            <button type="button" onClick={() => setTestOpen(true)} disabled={!hasContent} className="btn-secondary">
              <FlaskConical className="h-4 w-4" /> Enviar teste
            </button>
            <button type="button" onClick={() => setConfirmOpen(true)} disabled={!canSend} className="btn-primary">
              <Send className="h-4 w-4" /> Disparar {counts.total > 0 && <span className="rounded-md bg-emerald-950/30 px-1.5 text-xs tabular-nums">{counts.total}</span>}
            </button>
          </>
        }
      />

      {status && !connected && (
        <div className="mb-5 flex items-center gap-3 rounded-xl border border-amber-500/25 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
          <AlertTriangle className="h-4 w-4 shrink-0 text-amber-300" />
          <span className="flex-1">
            {status.configured ? "O WhatsApp não está conectado. Conecte a instância para conseguir disparar." : "Configure UAZAPI_URL e UAZAPI_TOKEN no arquivo .env."}
          </span>
          <Link href="/conexao" className="btn-secondary h-8 px-3 text-xs">
            Conectar <ExternalLink className="h-3 w-3" />
          </Link>
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-[1fr_420px]">
        <div className="space-y-4">
          <div>
            <label className="label">Mensagem</label>
            <MessageComposer value={message} onChange={setMessage} />
          </div>

          <div className="card p-4">
            <button type="button" onClick={() => setShowSettings((s) => !s)} className="flex w-full items-center justify-between text-left">
              <span className="flex items-center gap-2 text-sm font-medium text-slate-200">
                <Settings2 className="h-4 w-4 text-slate-400" /> Opções do disparo
              </span>
              <span className="flex items-center gap-1.5 text-xs text-slate-500">
                <Timer className="h-3.5 w-3.5" /> {delayMin}–{delayMax}s entre envios · {estimate}
              </span>
            </button>
            {showSettings && (
              <div className="mt-4 grid gap-4 sm:grid-cols-3">
                <div className="sm:col-span-1">
                  <label className="label">Nome da campanha</label>
                  <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Opcional" className="input" />
                </div>
                <div>
                  <label className="label">Intervalo mínimo (s)</label>
                  <input type="number" min={0} max={600} value={delayMin} onChange={(e) => setDelayMin(Number(e.target.value))} className="input" />
                </div>
                <div>
                  <label className="label">Intervalo máximo (s)</label>
                  <input type="number" min={0} max={600} value={delayMax} onChange={(e) => setDelayMax(Number(e.target.value))} className="input" />
                </div>
                <p className="text-xs leading-relaxed text-slate-500 sm:col-span-3">
                  Um intervalo aleatório entre os envios deixa o disparo mais natural e reduz o risco de bloqueio do número. Recomendado: 4 a 10 segundos.
                </p>
              </div>
            )}
          </div>

          <div>
            <label className="label">Pré-visualização</label>
            <MessagePreview message={message} />
          </div>
        </div>

        <div className="space-y-4">
          <div>
            <label className="label">Destinatários</label>
            <RecipientPicker value={selection} onChange={setSelection} />
          </div>
          <SelectionSummary value={selection} onChange={setSelection} />
        </div>
      </div>

      {/* Confirmação */}
      <Modal
        open={confirmOpen}
        onClose={() => !sending && setConfirmOpen(false)}
        title="Confirmar disparo"
        description="Revise antes de enviar. Não é possível desfazer mensagens já entregues."
        footer={
          <>
            <button type="button" onClick={() => setConfirmOpen(false)} disabled={sending} className="btn-secondary">
              Voltar
            </button>
            <button type="button" onClick={start} disabled={sending || !connected} className="btn-primary">
              {sending ? <Spinner /> : <Send className="h-4 w-4" />} Disparar agora
            </button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-2 text-center">
            <SummaryStat label="Destinatários" value={counts.total} />
            <SummaryStat label="Contatos" value={counts.contacts} />
            <SummaryStat label="Grupos" value={counts.groups} />
          </div>
          <div className="text-xs text-slate-400">
            Intervalo de {delayMin}–{delayMax}s entre envios · duração estimada {estimate}
            {message.attachments.length > 0 && ` · ${message.attachments.length} anexo${message.attachments.length > 1 ? "s" : ""}`}
          </div>
          <MessagePreview message={message} />
          {!connected && <p className="text-xs text-rose-300">O WhatsApp não está conectado.</p>}
        </div>
      </Modal>

      {/* Teste */}
      <Modal
        open={testOpen}
        onClose={() => !testing && setTestOpen(false)}
        title="Enviar mensagem de teste"
        description="Envie a mensagem para um único número (o seu, por exemplo) antes de disparar para todos."
        footer={
          <>
            <button type="button" onClick={() => setTestOpen(false)} disabled={testing} className="btn-secondary">
              Cancelar
            </button>
            <button type="button" onClick={sendTest} disabled={testing || testNumber.replace(/\D/g, "").length < 10} className="btn-primary">
              {testing ? <Spinner /> : <FlaskConical className="h-4 w-4" />} Enviar teste
            </button>
          </>
        }
      >
        <label className="label">Número com DDI e DDD</label>
        <input value={testNumber} onChange={(e) => setTestNumber(e.target.value)} placeholder="5511999999999" className="input" autoFocus />
      </Modal>

      {/* Progresso */}
      <Modal
        open={Boolean(activeId)}
        onClose={() => {
          if (running) {
            router.push(`/historico/${activeId}`);
          }
          reset();
        }}
        title={campaign?.name || "Disparo em andamento"}
        description={running ? "Você pode fechar esta janela; o envio continua em segundo plano." : "Disparo finalizado."}
        size="lg"
        footer={
          <>
            {activeId && (
              <Link href={`/historico/${activeId}`} className="btn-secondary">
                Ver no histórico
              </Link>
            )}
            <button type="button" onClick={reset} className="btn-primary">
              {running ? "Continuar em segundo plano" : "Nova campanha"}
            </button>
          </>
        }
      >
        {campaign ? (
          <CampaignProgress campaign={campaign} running={running} />
        ) : (
          <div className="flex items-center justify-center py-10 text-slate-400">
            <Spinner className="mr-2" /> Iniciando…
          </div>
        )}
      </Modal>
    </div>
  );
}

function SummaryStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-white/8 bg-white/[0.03] px-3 py-2.5">
      <p className="text-xl font-semibold text-white tabular-nums">{value}</p>
      <p className="text-[11px] text-slate-500">{label}</p>
    </div>
  );
}
