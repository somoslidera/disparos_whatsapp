"use client";

import { Lock, Send } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { api } from "@/lib/client";
import { Spinner } from "./ui";

export function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Sem senha configurada, esta tela não deve aparecer: volta para o app.
  useEffect(() => {
    let active = true;
    void fetch("/api/auth/check", { cache: "no-store" })
      .then((r) => r.json().then((d: { enabled?: boolean }) => ({ ok: r.ok, d })))
      .then(({ ok, d }) => {
        if (active && ok && d.enabled === false) router.replace(params.get("next") || "/");
      })
      .catch(() => null);
    return () => {
      active = false;
    };
  }, [router, params]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await api("/api/auth/login", { method: "POST", body: JSON.stringify({ password }) });
      router.replace(params.get("next") || "/");
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <form onSubmit={submit} className="card animate-fade-up w-full max-w-sm p-8">
        <div className="mb-6 flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-brand-300 to-brand-600">
            <Send className="h-4 w-4 text-emerald-950" strokeWidth={2.5} />
          </span>
          <div>
            <h1 className="font-semibold text-white">Disparos WhatsApp</h1>
            <p className="text-xs text-slate-500">Acesso restrito</p>
          </div>
        </div>
        <label className="label">Senha</label>
        <div className="relative">
          <Lock className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-slate-500" />
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} className="input pl-9" autoFocus />
        </div>
        {error && <p className="mt-2 text-xs text-rose-300">{error}</p>}
        <button type="submit" disabled={loading || !password} className="btn-primary mt-5 w-full">
          {loading && <Spinner />} Entrar
        </button>
      </form>
    </div>
  );
}
