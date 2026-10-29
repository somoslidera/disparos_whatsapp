import type { Audience, AudienceMember, AudienceRule, CampaignRecipient, MemberType, WaContact, WaGroup } from "./types";
import { isGroupJid } from "./phone";

export type SelectionItem = { type: MemberType; id: string; name: string };

export interface DirectoryLike {
  groups: WaGroup[];
  contacts: WaContact[];
}

/** Normaliza para comparar nomes: sem acentos, minúsculas, espaços colapsados. */
export function normName(s: string): string {
  return (s || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function ruleMatches(rule: AudienceRule, name: string): boolean {
  const v = normName(rule.value);
  if (!v) return false;
  const n = normName(name);
  if (rule.op === "contains") return n.includes(v);
  if (rule.op === "endsWith") return n.endsWith(v);
  return n.startsWith(v);
}

export function hasRules(a: Audience): boolean {
  return Boolean(a.rules?.some((r) => r.value.trim()));
}

/** Itens do diretório que batem com as regras da lista (antes das exclusões). */
export function ruleCandidates(rules: AudienceRule[] | undefined, dir: DirectoryLike | undefined): SelectionItem[] {
  if (!rules?.length || !dir) return [];
  const out = new Map<string, SelectionItem>();
  for (const rule of rules) {
    if (!rule.value.trim()) continue;
    if (rule.target === "group") {
      for (const g of dir.groups) if (ruleMatches(rule, g.name)) out.set(g.id, { type: "group", id: g.id, name: g.name });
    } else {
      for (const c of dir.contacts) if (c.name !== c.phone && ruleMatches(rule, c.name)) out.set(c.id, { type: "contact", id: c.id, name: c.name });
    }
  }
  return [...out.values()].sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
}

/**
 * Expande uma seleção (contatos, grupos do WhatsApp e listas) em destinatários únicos.
 * Listas podem conter outras listas (ciclos são ignorados) e regras automáticas, que são
 * resolvidas contra o diretório de grupos/contatos mais recente.
 */
export function resolveRecipients(
  selection: SelectionItem[],
  audiences: Audience[],
  dir?: DirectoryLike,
): Omit<CampaignRecipient, "status">[] {
  const byId = new Map(audiences.map((a) => [a.id, a]));
  const out = new Map<string, Omit<CampaignRecipient, "status">>();
  const visited = new Set<string>();

  const add = (m: SelectionItem | AudienceMember) => {
    if (m.type === "audience") {
      if (visited.has(m.id)) return;
      visited.add(m.id);
      const a = byId.get(m.id);
      if (!a) return;
      for (const child of a.members) add(child);
      const excluded = new Set(a.excludeIds || []);
      for (const item of ruleCandidates(a.rules, dir)) if (!excluded.has(item.id)) add(item);
      return;
    }
    if (!m.id) return;
    const type = m.type === "group" || isGroupJid(m.id) ? "group" : "contact";
    if (!out.has(m.id)) out.set(m.id, { id: m.id, name: m.name || m.id, type });
  };

  for (const s of selection) add(s);
  return [...out.values()];
}

/** Contagem de destinatários finais de uma lista (já expandida), por tipo. */
export function countAudience(audience: Audience, audiences: Audience[], dir?: DirectoryLike) {
  const r = resolveRecipients([{ type: "audience", id: audience.id, name: audience.name }], audiences, dir);
  return { total: r.length, contacts: r.filter((x) => x.type === "contact").length, groups: r.filter((x) => x.type === "group").length };
}

/** Verdadeiro se a seleção usa (direta ou indiretamente) alguma lista com regras automáticas. */
export function selectionUsesRules(selection: SelectionItem[], audiences: Audience[]): boolean {
  const byId = new Map(audiences.map((a) => [a.id, a]));
  const seen = new Set<string>();
  const stack = selection.filter((s) => s.type === "audience").map((s) => s.id);
  while (stack.length) {
    const id = stack.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    const a = byId.get(id);
    if (!a) continue;
    if (hasRules(a)) return true;
    for (const m of a.members) if (m.type === "audience") stack.push(m.id);
  }
  return false;
}

/**
 * Sugere uma regra a partir dos membros atuais: o prefixo mais comum (até o primeiro "|" ou "-",
 * ou a primeira palavra) quando cobre pelo menos metade dos membros daquele tipo.
 */
export function suggestRule(members: SelectionItem[], target: "group" | "contact"): { op: "startsWith" | "endsWith"; value: string; covers: number; of: number } | null {
  const names = members.filter((m) => m.type === target).map((m) => m.name.trim()).filter(Boolean);
  if (names.length < 2) return null;
  const tally = (pick: (n: string) => string | null) => {
    const counts = new Map<string, number>();
    for (const n of names) {
      const v = pick(n);
      if (v && v.length >= 2) counts.set(v, (counts.get(v) || 0) + 1);
    }
    let best: [string, number] | null = null;
    for (const e of counts) if (!best || e[1] > best[1]) best = e;
    return best;
  };
  const prefix = tally((n) => {
    const sep = n.search(/[|\-–:]/);
    return sep > 0 && sep <= 20 ? n.slice(0, sep + 1).trim() : n.split(/\s+/)[0];
  });
  const suffix = tally((n) => n.split(/\s+/).pop() || null);
  const min = Math.max(2, Math.ceil(names.length / 2));
  const candidates: { op: "startsWith" | "endsWith"; value: string; covers: number }[] = [];
  if (prefix && prefix[1] >= min) candidates.push({ op: "startsWith", value: prefix[0], covers: names.filter((n) => normName(n).startsWith(normName(prefix[0]))).length });
  if (suffix && suffix[1] >= min) candidates.push({ op: "endsWith", value: suffix[0], covers: names.filter((n) => normName(n).endsWith(normName(suffix[0]))).length });
  if (!candidates.length) return null;
  candidates.sort((a, b) => b.covers - a.covers || (a.op === "startsWith" ? -1 : 1));
  return { ...candidates[0], of: names.length };
}

/** Assinatura de uma regra para comparar versões (detecta regra nova ou alterada). */
export function ruleSignature(r: AudienceRule): string {
  return `${r.target}|${r.op}|${normName(r.value)}`;
}

/** Verifica se adicionar `childId` em `parentId` criaria um ciclo. */
export function wouldCreateCycle(parentId: string, childId: string, audiences: Audience[]): boolean {
  if (parentId === childId) return true;
  const byId = new Map(audiences.map((a) => [a.id, a]));
  const stack = [childId];
  const seen = new Set<string>();
  while (stack.length) {
    const cur = stack.pop()!;
    if (cur === parentId) return true;
    if (seen.has(cur)) continue;
    seen.add(cur);
    const a = byId.get(cur);
    if (!a) continue;
    for (const m of a.members) if (m.type === "audience") stack.push(m.id);
  }
  return false;
}
