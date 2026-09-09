import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <p className="text-6xl font-semibold text-white/20">404</p>
      <p className="mt-2 text-sm text-slate-400">Página não encontrada.</p>
      <Link href="/" className="btn-secondary mt-6">
        Voltar ao início
      </Link>
    </div>
  );
}
