"use client";

import { AlertTriangle, AtSign, CalendarClock, ExternalLink, FlaskConical, Send, Settings2, Timer } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { createCampaign, isBlankDraft, scheduleCampaign, sendOne, startCampaign } from "@/lib/campaign-client";
import type { SelectionItem } from "@/lib/audiences";
import { firstName, hasNameTag } from "@/lib/personalize";
import { onlyDigits, toContactJid } from "@/lib/phone";
import type { MessageDraft, StoredMessage } from "@/lib/types";
import { BlocksEditor } from "./blocks-editor";
import { CampaignProgress, useCampaign } from "./campaign-progress";
import { useData } from "./data-provider";
import { newBlock } from "./message-composer";
import { MessagePreview } from "./message-preview";
import { RecipientPicker } from "./recipient-picker";
import { SelectionSummary, useResolvedCount } from "./selection-summary";
import { Modal, PageHeader, Spinner, Toggle } from "./ui";

const emptyDraft = (): MessageDraft => ({ blocks: [newBlock()] });

/** Valor inicial do campo datetime-local: próxima hora cheia. */
function defaultScheduleValue() {
  const d = new Date();
  d.setMinutes(0, 0, 0);
  d.setHours(d.getHours() + 1);
  return toLocalInput(d);
}

function toLocalInput(d: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function NewCampaign() {
  const router = useRouter();
  const { status, audiences, contacts } = useData();
  const params = useSearchParams();
  const [message, setMessage] = useState<MessageDraft>(emptyDraft);
  const [selection, setSelection] = useState<SelectionItem[]>([]);
  const [name, setName] = useState("");
  const [delayMin, setDelayMin] = useState(4);
  const [delayMax, setDelayMax] = useState(10);
  const [nameFallback, setNameFallback] = useState("");
  const [scheduleOn, setScheduleOn] = useState(false);
  const [scheduleAt, setScheduleAt] = useState(defaultScheduleValue);
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
    const draft = JSON.parse(raw) as { message?: StoredMessage; selection?: SelectionItem[]; nameFallback?: string };
    queueMicrotask(() => {
      if (draft.message?.blocks?.length) {
        setMessage({ blocks: draft.message.blocks.map((b) => ({ id: b.id || newBlock().id, text: b.text || "", attachments: [] })) });
      }
      if (draft.selection) setSelection(draft.selection);
      if (draft.nameFallback) setNameFallback(draft.nameFallback);
      toast.success("Campanha carregada. Revise antes de disparar.");
    });
  }, []);

  const listaId = params.get("lista");
  useEffect(() => {
    if (!listaId) return;
    const a = audiences.find((x) => x.id === listaId);
    queueMicrotask(() => {
      if (a) setSelection((prev) => (prev.some((p) => p.type === "audience" && p.id === a.id) ? prev : [...prev, { type: "audience", id: a.id, name: a.name }]));
      router.replace("/");
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listaId]);

  const hasContent = !isBlankDraft(message);
  const canSend = hasContent && counts.total > 0 && !sending;
  const connected = Boolean(status?.connected);
  const usesName = message.blocks.some((b) => hasNameTag(b.text));
  const blockCount = message.blocks.filter((b) => b.text.trim() || b.attachments.length > 0).length;
  const attachmentCount = message.blocks.reduce((n, b) => n + b.attachments.length, 0);
  const avg = (Math.max(delayMin, 0) + Math.max(delayMax, delayMin)) / 2;
  const estimateSec = Math.max(0, counts.total - 1) * avg + counts.total * (blockCount * 2 + attachmentCount * 2);
  const estimate = estimateSec < 90 ? `~${Math.round(estimateSec)} s` : `~${Math.round(estimateSec / 60)} min`;

  const scheduledDate = useMemo(() => (scheduleOn && scheduleAt ? new Date(scheduleAt) : null), [scheduleOn, scheduleAt]);
  // A checagem de "data no passado" acontece em createCampaign (no clique), para não depender do relógio durante a renderização.
  const scheduleInvalid = scheduleOn && (!scheduledDate || Number.isNaN(scheduledDate.getTime()));
  const scheduleLabel = scheduledDate && !Number.isNaN(scheduledDate.getTime()) ? scheduledDate.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "";

  // Nome de exemplo na pré-visualização: primeiro contato selecionado com nome real
  const sampleName = useMemo(() => {
    const c = selection.find((s) => s.type === "contact" && firstName(s.name));
    return c?.name || "Maria Silva";
  }, [selection]);

  const start = async () => {
    setSending(true);
    try {
      if (delayMin > delayMax) throw new Error("O intervalo mínimo não pode ser maior que o máximo.");
      const c = createCampaign({
        name,
        message,
        selection,
        settings: { delayMinSeconds: delayMin, delayMaxSeconds: delayMax, nameFallback: nameFallback.trim() || undefined },
        scheduledFor: scheduledDate,
      });
      if (scheduledDate) {
        await scheduleCampaign(c, message);
        setConfirmOpen(false);
        toast.success(`Disparo agendado para ${scheduleLabel}. Mantenha esta aba aberta.`);
        reset();
        router.push(`/historico/${c.id}`);
        return;
      }
      startCampaign(c, message);
      setConfirmOpen(false);
      setActiveId(c.id);
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
      const jid = toContactJid(onlyDigits(testNumber));
      const contactName = contacts.data.find((c) => c.id === jid)?.name;
      await sendOne(testNumber, message, contactName, nameFallback);
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
    setMessage(emptyDraft());
    setSelection([]);
    setName("");
    setScheduleOn(false);
  }, []);

  const mainLabel = scheduleOn ? "Agendar" : "Disparar";

  return (
    <div className="animate-fade-up">
      <PageHeader
        title="Nova campanha"
        subtitle="Escreva a mensagem em um ou mais blocos, escolha para quem enviar e dispare agora ou agende."
        actions={
          <>
            <button type="button" onClick={() => setTestOpen(true)} disabled={!hasContent} className="btn-secondary">
              <FlaskConical className="h-4 w-4" /> Enviar teste
            </button>
            <button type="button" onClick={() => setConfirmOpen(true)} disabled={!canSend || scheduleInvalid} className="btn-primary">
              {scheduleOn ? <CalendarClock className="h-4 w-4" /> : <Send className="h-4 w-4" />} {mainLabel}{" "}
              {counts.total > 0 && <span className="rounded-md bg-emerald-950/30 px-1.5 text-xs tabular-nums">{counts.total}</span>}
            </button>
          </>
        }
      />

      {status && !connected && (
        <div className="mb-5 flex items-center gap-3 rounded-xl border border-amber-500/25 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
          <AlertTriangle className="h-4 w-4 shrink-0 text-amber-300" />
          <span className="flex-1">
            {status.configured ? "O WhatsApp não está conectado. Conecte a instância para conseguir disparar." : "Informe a URL e o token do uazapi na aba Conexão para começar."}
          </span>
          <Link href="/conexao" className="btn-secondary h-8 px-3 text-xs">
            {status.configured ? "Conectar" : "Configurar"} <ExternalLink className="h-3 w-3" />
          </Link>
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-[1fr_420px]">
        <div className="space-y-4">
          <div>
            <label className="label">Mensagem</label>
            <BlocksEditor value={message} onChange={setMessage} />
          </div>

          <div className="card p-4">
            <button type="button" onClick={() => setShowSettings((s) => !s)} className="flex w-full items-center justify-between text-left">
              <span className="flex items-center gap-2 text-sm font-medium text-slate-200">
                <Settings2 className="h-4 w-4 text-slate-400" /> Opções do disparo
              </span>
              <span className="flex items-center gap-3 text-xs text-slate-500">
                {scheduleOn && scheduleLabel && (
                  <span className="flex items-center gap-1 text-brand-300">
                    <CalendarClock className="h-3.5 w-3.5" /> {scheduleLabel}
                  </span>
                )}
                <span className="flex items-center gap-1">
                  <Timer className="h-3.5 w-3.5" /> {delayMin}–{delayMax}s entre envios · {estimate}
                </span>
              </span>
            </button>
            {showSettings && (
              <div className="mt-4 space-y-5">
                <div className="grid gap-4 sm:grid-cols-3">
                  <div>
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
                </div>

                <div className="rounded-xl border border-white/8 bg-white/[0.02] p-4">
                  <div className="flex items-center justify-between gap-3">
                    <span className="flex items-center gap-2 text-sm text-slate-200">
                      <CalendarClock className="h-4 w-4 text-brand-300" /> Agendar envio
                    </span>
                    <Toggle checked={scheduleOn} onChange={setScheduleOn} label={scheduleOn ? "Ligado" : "Desligado"} />
                  </div>
                  {scheduleOn && (
                    <div className="mt-3 grid gap-3 sm:grid-cols-[auto_1fr] sm:items-end">
                      <div>
                        <label className="label">Data e hora</label>
                        <input type="datetime-local" value={scheduleAt} min={toLocalInput(new Date())} onChange={(e) => setScheduleAt(e.target.value)} className="input" />
                      </div>
                      <p className="text-[11px] leading-relaxed text-slate-500">
                        O disparo sai deste navegador no horário marcado. Deixe esta aba aberta (pode estar em segundo plano). Se fechar e reabrir antes da hora, o agendamento continua.
                      </p>
                      {scheduleInvalid && <p className="text-xs text-rose-300 sm:col-span-2">Informe uma data e hora válidas.</p>}
                    </div>
                  )}
                </div>

                <div className="rounded-xl border border-white/8 bg-white/[0.02] p-4">
                  <div className="flex items-center gap-2 text-sm text-slate-200">
                    <AtSign className="h-4 w-4 text-brand-300" /> Personalização com nome
                  </div>
                  <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
                    Escreva <code className="rounded bg-white/10 px-1">{"{nome}"}</code> (ou use o botão “Nome”) para inserir o primeiro nome salvo na agenda. Também aceita{" "}
                    <code className="rounded bg-white/10 px-1">{"{nome_completo}"}</code>. Em grupos e contatos sem nome salvo, usa o texto abaixo.
                  </p>
                  <div className="mt-3 max-w-xs">
                    <label className="label">Quando não houver nome</label>
                    <input value={nameFallback} onChange={(e) => setNameFallback(e.target.value)} placeholder="Ex.: cliente (vazio = remove o nome)" className="input" />
                  </div>
                </div>
              </div>
            )}
          </div>

          <div>
            <label className="label">
              Pré-visualização{usesName && <span className="ml-2 normal-case text-slate-500">exemplo com “{firstName(sampleName) || sampleName}”</span>}
            </label>
            <MessagePreview message={message} sampleName={sampleName} nameFallback={nameFallback} />
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
        title={scheduleOn ? "Confirmar agendamento" : "Confirmar disparo"}
        description={scheduleOn ? `O envio começará em ${scheduleLabel}, a partir deste navegador.` : "Revise antes de enviar. Não é possível desfazer mensagens já entregues."}
        footer={
          <>
            <button type="button" onClick={() => setConfirmOpen(false)} disabled={sending} className="btn-secondary">
              Voltar
            </button>
            <button type="button" onClick={start} disabled={sending || (!connected && !scheduleOn)} className="btn-primary">
              {sending ? <Spinner /> : scheduleOn ? <CalendarClock className="h-4 w-4" /> : <Send className="h-4 w-4" />} {scheduleOn ? "Agendar" : "Disparar agora"}
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
            {blockCount} bloco{blockCount === 1 ? "" : "s"} por destinatário · intervalo de {delayMin}–{delayMax}s · duração estimada {estimate}
            {attachmentCount > 0 && ` · ${attachmentCount} anexo${attachmentCount > 1 ? "s" : ""}`}
          </div>
          <MessagePreview message={message} sampleName={sampleName} nameFallback={nameFallback} />
          {!connected && !scheduleOn && <p className="text-xs text-rose-300">O WhatsApp não está conectado.</p>}
          {!connected && scheduleOn && <p className="text-xs text-amber-300">O WhatsApp não está conectado agora. Ele precisa estar conectado no horário do envio.</p>}
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
        {usesName && <p className="mt-2 text-[11px] text-slate-500">Se o número estiver na sua agenda, {"{nome}"} usará o nome salvo.</p>}
      </Modal>

      {/* Progresso */}
      <Modal
        open={Boolean(activeId)}
        onClose={() => {
          if (running) router.push(`/historico/${activeId}`);
          reset();
        }}
        title={campaign?.name || "Disparo em andamento"}
        description={running ? "Você pode fechar esta janela, mas mantenha a aba do app aberta até o fim." : "Disparo finalizado."}
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
