"use client";

import { ArrowLeft, Copy } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { formatDate } from "@/lib/client";
import { CampaignProgress, useCampaign } from "./campaign-progress";
import { MessagePreview } from "./message-preview";
import { PageHeader, Skeleton } from "./ui";

export function CampaignDetail({ id }: { id: string }) {
  const { campaign, running, error } = useCampaign(id);
  const router = useRouter();

  const reuse = () => {
    if (!campaign) return;
    try {
      sessionStorage.setItem("disparos:draft", JSON.stringify({ message: campaign.message, selection: campaign.sources }));
      router.push("/");
    } catch {
      toast.error("Não foi possível copiar a campanha.");
    }
  };

  return (
    <div className="animate-fade-up">
      <Link href="/historico" className="mb-4 inline-flex items-center gap-1.5 text-xs text-slate-400 hover:text-white">
        <ArrowLeft className="h-3.5 w-3.5" /> Voltar ao histórico
      </Link>
      <PageHeader
        title={campaign?.name || "Campanha"}
        subtitle={campaign ? `Criada em ${formatDate(campaign.createdAt)}${campaign.finishedAt ? ` · finalizada em ${formatDate(campaign.finishedAt)}` : ""}` : undefined}
        actions={
          campaign && (
            <button type="button" onClick={reuse} className="btn-secondary">
              <Copy className="h-4 w-4" /> Reutilizar campanha
            </button>
          )
        }
      />
      {error ? (
        <div className="card p-6 text-sm text-rose-300">{error}</div>
      ) : !campaign ? (
        <Skeleton className="h-64" />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
          <div className="card p-5">
            <CampaignProgress campaign={campaign} running={running} />
          </div>
          <div className="space-y-4">
            <div>
              <label className="label">Mensagem enviada</label>
              <MessagePreview message={campaign.message} />
            </div>
            <div className="card p-4 text-xs text-slate-400">
              <p>
                Intervalo entre envios: {campaign.settings.delayMinSeconds}–{campaign.settings.delayMaxSeconds}s
              </p>
              <p className="mt-1">Origens: {campaign.sources.map((s) => s.name).join(", ")}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
