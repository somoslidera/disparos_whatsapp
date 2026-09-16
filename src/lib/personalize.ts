import { onlyDigits } from "./phone";

export const NAME_TAG = "{nome}";
export const FULL_NAME_TAG = "{nome_completo}";
const EMPTY = "__NOME_VAZIO__";

/** Retorna false para nomes que na verdade são números de telefone ou vazios. */
export function isRealName(name: string | undefined | null): boolean {
  if (!name) return false;
  const trimmed = name.trim();
  if (!trimmed) return false;
  const digits = onlyDigits(trimmed);
  if (digits.length >= 8 && digits.length >= trimmed.replace(/[\s+()-]/g, "").length * 0.8) return false;
  if (/^(número oculto|sem nome)$/i.test(trimmed)) return false;
  return /\p{L}/u.test(trimmed);
}

function titleCase(word: string): string {
  if (!word) return word;
  // Mantém siglas curtas como estão (ex.: "JP")
  if (word.length <= 3 && word === word.toUpperCase()) return word;
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}

/** Primeiro nome, limpo de emojis, símbolos e prefixos comuns (Sr., Dra., Dona...). */
export function firstName(name: string | undefined | null): string | null {
  if (!isRealName(name)) return null;
  const cleaned = (name as string)
    .replace(/[\p{Extended_Pictographic}\p{Emoji_Presentation}️]/gu, " ")
    .replace(/[^\p{L}\p{M}\s'-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  const skip = new Set(["sr", "sra", "dr", "dra", "seu", "dona", "srta"]);
  const parts = cleaned.split(" ").filter((p) => /\p{L}/u.test(p));
  const first = parts.find((p) => !skip.has(p.toLowerCase()) || parts.length === 1);
  if (!first) return null;
  return titleCase(first);
}

export function fullName(name: string | undefined | null): string | null {
  if (!isRealName(name)) return null;
  const cleaned = (name as string)
    .replace(/[\p{Extended_Pictographic}\p{Emoji_Presentation}️]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned || null;
}

export function hasNameTag(text: string): boolean {
  return text.includes(NAME_TAG) || text.includes(FULL_NAME_TAG);
}

/**
 * Substitui {nome} e {nome_completo}. Sem nome disponível, usa o texto reserva;
 * se o reserva for vazio, remove a marca e ajusta espaços e vírgulas soltas ("Olá {nome}," vira "Olá,").
 */
export function personalize(text: string, contactName: string | undefined | null, fallback = ""): string {
  if (!hasNameTag(text)) return text;
  const first = firstName(contactName);
  const full = fullName(contactName);
  const fb = fallback.trim();
  const replace = (value: string | null) => value || fb || EMPTY;
  let out = text.split(FULL_NAME_TAG).join(replace(full)).split(NAME_TAG).join(replace(first));
  if (out.includes(EMPTY)) {
    out = out
      .replace(new RegExp(`[ \\t]*${EMPTY}[ \\t]*([,!?.;:])`, "g"), "$1")
      .replace(new RegExp(`[ \\t]+${EMPTY}`, "g"), "")
      .replace(new RegExp(`${EMPTY}[ \\t]+`, "g"), "")
      .split(EMPTY)
      .join("");
  }
  return out;
}
