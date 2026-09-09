"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { api } from "@/lib/client";
import { getSettings, subscribeSettings } from "@/lib/settings";
import { getAudiences, getServerAudiences, subscribe as subscribeStore } from "@/lib/store";
import { countAudience } from "@/lib/audiences";
import type { Audience, InstanceStatus, UazapiSettings, WaContact, WaGroup } from "@/lib/types";

export type AudienceWithTotal = Audience & { total: number };
export type Status = (InstanceStatus & { configured: boolean; envConfigured?: boolean }) | null;

interface Resource<T> {
  data: T;
  loading: boolean;
  error: string | null;
  loaded: boolean;
}

interface DataContextValue {
  settings: UazapiSettings | null;
  status: Status;
  statusError: string | null;
  refreshStatus: () => Promise<void>;
  contacts: Resource<WaContact[]>;
  groups: Resource<WaGroup[]>;
  audiences: AudienceWithTotal[];
  loadContacts: (force?: boolean) => Promise<void>;
  loadGroups: (force?: boolean) => Promise<void>;
}

const DataContext = createContext<DataContextValue | null>(null);

function useResource<T>(initial: T, fetcher: (force: boolean) => Promise<T>) {
  const [state, setState] = useState<Resource<T>>({ data: initial, loading: false, error: null, loaded: false });
  const inflight = useRef<Promise<void> | null>(null);
  const load = useCallback(
    async (force = false) => {
      if (inflight.current && !force) return inflight.current;
      const p = Promise.resolve()
        .then(() => setState((s) => ({ ...s, loading: true, error: null })))
        .then(() => fetcher(force))
        .then((data) => setState({ data, loading: false, error: null, loaded: true }))
        .catch((err: Error) => setState((s) => ({ ...s, loading: false, error: err.message, loaded: true })))
        .finally(() => {
          inflight.current = null;
        });
      inflight.current = p;
      return p;
    },
    [fetcher],
  );
  return [state, load] as const;
}

const noopSettings = () => null;

export function DataProvider({ children }: { children: ReactNode }) {
  const settings = useSyncExternalStore(subscribeSettings, getSettings, noopSettings);
  const rawAudiences = useSyncExternalStore(subscribeStore, getAudiences, getServerAudiences);
  const audiences = useMemo(() => rawAudiences.map((a) => ({ ...a, total: countAudience(a, rawAudiences) })), [rawAudiences]);

  const [status, setStatus] = useState<Status>(null);
  const [statusError, setStatusError] = useState<string | null>(null);

  const refreshStatus = useCallback(async () => {
    try {
      const s = await api<InstanceStatus & { configured: boolean; envConfigured?: boolean }>("/api/instance/status");
      setStatus(s);
      setStatusError(null);
    } catch (err) {
      setStatusError((err as Error).message);
      setStatus((prev) => (prev ? { ...prev, connected: false } : { configured: true, connected: false, loggedIn: false, status: "error" }));
    }
  }, []);

  useEffect(() => {
    if (typeof window !== "undefined" && location.pathname.startsWith("/login")) return;
    const run = () => void refreshStatus();
    const first = setTimeout(run, 0);
    const t = setInterval(run, 20_000);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, [refreshStatus, settings]);

  const [contacts, loadContacts] = useResource<WaContact[]>(
    [],
    useCallback(async () => (await api<{ contacts: WaContact[] }>("/api/whatsapp/contacts")).contacts, []),
  );
  const [groups, loadGroups] = useResource<WaGroup[]>(
    [],
    useCallback(async (force: boolean) => (await api<{ groups: WaGroup[] }>(`/api/whatsapp/groups${force ? "?force=1" : ""}`)).groups, []),
  );

  const value = useMemo<DataContextValue>(
    () => ({ settings, status, statusError, refreshStatus, contacts, groups, audiences, loadContacts, loadGroups }),
    [settings, status, statusError, refreshStatus, contacts, groups, audiences, loadContacts, loadGroups],
  );

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}

export function useData(): DataContextValue {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error("useData deve ser usado dentro de DataProvider");
  return ctx;
}
