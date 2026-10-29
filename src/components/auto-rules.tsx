"use client";

import clsx from "clsx";
import { Plus, Sparkles, Trash2, User, Users, Wand2 } from "lucide-react";
import { nanoid } from "nanoid";
import { useMemo, useState } from "react";
import { ruleCandidates, ruleSignature, suggestRule, type DirectoryLike, type SelectionItem } from "@/lib/audiences";
import type { AudienceRule } from "@/lib/types";
import { useData } from "./data-provider";
import { Checkbox, SearchInput } from "./ui";

/**
 * Regra automática "só adiciona": quando uma regra é criada (ou alterada), tudo que já existe no
 * WhatsApp e bate com ela, mas não está na lista, fica "fora da lista". Só o que aparecer depois
 * entra sozinho. Qualquer item pode ser incluído ou retirado manualmente.
 */
function baselineFor(rules: AudienceRule[], originalRules: AudienceRule[], members: SelectionItem[], dir: DirectoryLike): Set<string> {
  const orig = new Set(originalRules.map(ruleSignature));
  const fresh = rules.filter((r) => r.value.trim() && !orig.has(ruleSignature(r)));
  const memberIds = new Set(members.map((m) => m.id));
  return new Set(ruleCandidates(fresh, dir).map((c) => c.id).filter((id) => !memberIds.has(id)));
}

export function finalizeExcludes(input: {
  rules: AudienceRule[];
  originalRules: AudienceRule[];
  baseExclude: string[];
  included: Set<string>;
  excluded: Set<string>;
  members: SelectionItem[];
  dir: DirectoryLike;
  groupsReady: boolean;
  contactsReady: boolean;
}): { excludeIds: string[]; error?: string } {
  const orig = new Set(input.originalRules.map(ruleSignature));
  const fresh = input.rules.filter((r) => r.value.trim() && !orig.has(ruleSignature(r)));
  if (fresh.some((r) => r.target === "group") && !input.groupsReady) return { excludeIds: [], error: "Aguarde carregar os grupos do WhatsApp antes de salvar a regra." };
  if (fresh.some((r) => r.target === "contact") && !input.contactsReady) return { excludeIds: [], error: "Aguarde carregar os contatos do WhatsApp antes de salvar a regra." };
  const base = baselineFor(input.rules, input.originalRules, input.members, input.dir);
  const out = new Set([...input.baseExclude, ...base, ...input.excluded]);
  for (const id of input.included) out.delete(id);
  return { excludeIds: [...out] };
}

export function AutoRules({
  rules,
  onRulesChange,
  originalRules,
  baseExclude,
  members,
  included,
  excluded,
  onIncludedChange,
  onExcludedChange,
}: {
  rules: AudienceRule[];
  onRulesChange: (r: AudienceRule[]) => void;
  originalRules: AudienceRule[];
  baseExclude: string[];
  members: SelectionItem[];
  included: Set<string>;
  excluded: Set<string>;
  onIncludedChange: (s: Set<string>) => void;
  onExcludedChange: (s: Set<string>) => void;
}) {
  const { groups, contacts } = useData();
  const [query, setQuery] = useState("");
  const dir = useMemo(() => ({ groups: groups.data, contacts: contacts.data }), [groups.data, contacts.data]);
  const memberIds = useMemo(() => new Set(members.map((m) => m.id)), [members]);
  const baseline = useMemo(() => baselineFor(rules, originalRules, members, dir), [rules, originalRules, members, dir]);
  const baseSet = useMemo(() => new Set(baseExclude), [baseExclude]);

  const candidates = useMemo(() => ruleCandidates(rules, dir).filter((c) => !memberIds.has(c.id)), [rules, dir, memberIds]);
  const isOut = (id: string) => excluded.has(id) || (!included.has(id) && (baseSet.has(id) || baseline.has(id)));
  const inCount = candidates.filter((c) => !isOut(c.id)).length;
  const outCount = candidates.length - inCount;

  const toggle = (id: string) => {
    const inc = new Set(included);
    const exc = new Set(excluded);
    if (isOut(id)) {
      inc.add(id);
      exc.delete(id);
    } else {
      exc.add(id);
      inc.delete(id);
    }
    onIncludedChange(inc);
    onExcludedChange(exc);
  };

  const addRule = (partial: Partial<AudienceRule>) => onRulesChange([...rules, { id: nanoid(8), target: "group", op: "startsWith", value: "", ...partial }]);
  const update = (id: string, patch: Partial<AudienceRule>) => onRulesChange(rules.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const remove = (id: string) => onRulesChange(rules.filter((r) => r.id !== id));

  const sigs = new Set(rules.map(ruleSignature));
  const suggestions = (["group", "contact"] as const)
    .map((t) => ({ target: t, s: suggestRule(members, t) }))
    .filter((x): x is { target: "group" | "contact"; s: NonNullable<ReturnType<typeof suggestRule>> } => Boolean(x.s))
    .filter((x) => !sigs.has(ruleSignature({ id: "", target: x.target, op: x.s.op, value: x.s.value })));

  const q = query.trim().toLowerCase();
  const shown = q ? candidates.filter((c) => c.name.toLowerCase().includes(q)) : candidates;
  const loading = (rules.some((r) => r.target === "group") && !groups.loaded) || (rules.some((r) => r.target === "contact") && !contacts.loaded);

  return (
    <div className="rounded-2xl border border-white/8 bg-white/[0.02] p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Wand2 className="h-4 w-4 text-brand-300" />
        <span className="text-sm font-medium text-slate-200">Atualização automática</span>
        <span className="text-[11px] text-slate-500">Grupos e contatos novos que seguirem o formato entram sozinhos na lista.</span>
      </div>

      {rules.length > 0 && (
        <div className="mt-3 space-y-2">
          {rules.map((r) => (
            <div key={r.id} className="flex flex-wrap items-center gap-2">
              <select value={r.target} onChange={(e) => update(r.id, { target: e.target.value as AudienceRule["target"] })} className="input h-9 w-auto py-1 text-xs">
                <option value="group">Grupos</option>
                <option value="contact">Contatos</option>
              </select>
              <span className="text-xs text-slate-500">cujo nome</span>
              <select value={r.op} onChange={(e) => update(r.id, { op: e.target.value as AudienceRule["op"] })} className="input h-9 w-auto py-1 text-xs">
                <option value="startsWith">começa com</option>
                <option value="endsWith">termina com</option>
                <option value="contains">contém</option>
              </select>
              <input value={r.value} onChange={(e) => update(r.id, { value: e.target.value })} placeholder={r.target === "group" ? "PLL |" : "PLL"} className="input h-9 max-w-[220px] py-1 text-xs" />
              <button type="button" onClick={() => remove(r.id)} className="btn-ghost h-8 w-8 p-0 text-slate-500 hover:text-rose-300" title="Remover regra">
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        {suggestions.map(({ target, s }) => (
          <button key={target} type="button" onClick={() => addRule({ target, op: s.op, value: s.value })} className="btn-secondary h-8 gap-1.5 px-3 text-xs">
            <Sparkles className="h-3.5 w-3.5 text-amber-300" />
            {target === "group" ? "Grupos" : "Contatos"} que {s.op === "startsWith" ? "começam" : "terminam"} com “{s.value}” ({s.covers} de {s.of} da lista)
          </button>
        ))}
        <button type="button" onClick={() => addRule({ target: "group", op: "startsWith", value: "" })} className="btn-ghost h-8 gap-1.5 px-3 text-xs">
          <Plus className="h-3.5 w-3.5" /> Regra para grupos
        </button>
        <button type="button" onClick={() => addRule({ target: "contact", op: "endsWith", value: "" })} className="btn-ghost h-8 gap-1.5 px-3 text-xs">
          <Plus className="h-3.5 w-3.5" /> Regra para contatos
        </button>
      </div>

      {rules.some((r) => r.value.trim()) && (
        <div className="mt-4 border-t border-white/8 pt-3">
          <div className="mb-2 flex flex-wrap items-center gap-3 text-xs">
            <span className="text-slate-300">
              Além dos itens escolhidos acima: <strong className="text-brand-300 tabular-nums">{inCount}</strong> entram pela regra ·{" "}
              <strong className="text-slate-400 tabular-nums">{outCount}</strong> fora da lista
            </span>
            {loading && <span className="text-slate-500">carregando grupos e contatos…</span>}
            {candidates.length > 8 && <SearchInput value={query} onChange={setQuery} placeholder="Filtrar…" className="ml-auto w-48" />}
          </div>
          <p className="mb-2 text-[11px] leading-relaxed text-slate-500">
            Ao salvar uma regra nova, quem já existe no WhatsApp e não está na lista fica “fora da lista” (ex.: clientes que saíram do projeto). Só os que surgirem depois entram sozinhos.
            Marque ou desmarque para incluir ou retirar manualmente.
          </p>
          {shown.length > 0 && (
            <ul className="max-h-60 overflow-y-auto rounded-xl border border-white/8">
              {shown.map((c) => {
                const out = isOut(c.id);
                return (
                  <li key={c.id}>
                    <button type="button" onClick={() => toggle(c.id)} className={clsx("flex w-full items-center gap-3 px-3 py-1.5 text-left text-sm transition hover:bg-white/[0.04]", out && "opacity-60")}>
                      <Checkbox checked={!out} />
                      {c.type === "group" ? <Users className="h-3.5 w-3.5 shrink-0 text-violet-300" /> : <User className="h-3.5 w-3.5 shrink-0 text-brand-300" />}
                      <span className="min-w-0 flex-1 truncate text-slate-100">{c.name}</span>
                      <span className={clsx("text-[11px]", out ? "text-slate-500" : "text-brand-300")}>{out ? "fora da lista" : "entra"}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
