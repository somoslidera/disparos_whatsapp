import type { Audience, AudienceMember, CampaignRecipient, MemberType } from "./types";
import { isGroupJid } from "./phone";

export type SelectionItem = { type: MemberType; id: string; name: string };

/**
 * Expande uma seleção (contatos, grupos do WhatsApp e listas) em destinatários únicos.
 * Listas podem conter outras listas; ciclos são ignorados.
 */
export function resolveRecipients(
  selection: SelectionItem[],
  audiences: Audience[],
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
      return;
    }
    if (!m.id) return;
    const type = m.type === "group" || isGroupJid(m.id) ? "group" : "contact";
    if (!out.has(m.id)) out.set(m.id, { id: m.id, name: m.name || m.id, type });
  };

  for (const s of selection) add(s);
  return [...out.values()];
}

/** Conta destinatários finais de uma lista (já expandida). */
export function countAudience(audience: Audience, audiences: Audience[]): number {
  return resolveRecipients([{ type: "audience", id: audience.id, name: audience.name }], audiences).length;
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
