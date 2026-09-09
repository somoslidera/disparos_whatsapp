/** Normaliza um telefone/jid para o formato aceito pelo uazapi. */
export function onlyDigits(value: string): string {
  return (value || "").replace(/\D+/g, "");
}

export function isGroupJid(id: string): boolean {
  return /@g\.us$/i.test(id);
}

/** Converte "5511999999999", "+55 (11) 99999-9999" ou jid em jid individual. */
export function toContactJid(value: string): string {
  const v = (value || "").trim();
  if (/@(s\.whatsapp\.net|c\.us|lid)$/i.test(v)) return v.replace(/@c\.us$/i, "@s.whatsapp.net");
  if (isGroupJid(v)) return v;
  const digits = onlyDigits(v);
  return `${digits}@s.whatsapp.net`;
}

export function jidToPhone(jid: string): string {
  return onlyDigits((jid || "").split("@")[0].split(":")[0]);
}

/** Valor a enviar no campo `number` do uazapi: grupos usam o jid completo, contatos apenas dígitos. */
export function toSendNumber(id: string): string {
  if (isGroupJid(id)) return id;
  if (/@lid$/i.test(id)) return id;
  return jidToPhone(id);
}

/** Formata para exibição: +55 11 99999-9999 */
export function formatPhone(phone: string): string {
  const d = onlyDigits(phone);
  if (d.startsWith("55") && (d.length === 12 || d.length === 13)) {
    const ddd = d.slice(2, 4);
    const rest = d.slice(4);
    const part1 = rest.length === 9 ? rest.slice(0, 5) : rest.slice(0, 4);
    const part2 = rest.length === 9 ? rest.slice(5) : rest.slice(4);
    return `+55 ${ddd} ${part1}-${part2}`;
  }
  return d ? `+${d}` : "";
}
