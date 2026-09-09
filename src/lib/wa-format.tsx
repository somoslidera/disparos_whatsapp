import type { ReactNode } from "react";

/** Renderiza a formatação do WhatsApp (*negrito*, _itálico_, ~tachado~, ```mono```) para pré-visualização. */
export function renderWhatsAppText(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*[^*\n]+\*|_[^_\n]+_|~[^~\n]+~|```[^`]+```)/g;
  let last = 0;
  let key = 0;
  for (const m of text.matchAll(re)) {
    const idx = m.index ?? 0;
    if (idx > last) out.push(text.slice(last, idx));
    const token = m[0];
    const inner = token.startsWith("```") ? token.slice(3, -3) : token.slice(1, -1);
    if (token.startsWith("*")) out.push(<strong key={key++}>{inner}</strong>);
    else if (token.startsWith("_")) out.push(<em key={key++}>{inner}</em>);
    else if (token.startsWith("~")) out.push(<s key={key++}>{inner}</s>);
    else out.push(<code key={key++} className="rounded bg-black/30 px-1 font-mono text-[0.85em]">{inner}</code>);
    last = idx + token.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}
