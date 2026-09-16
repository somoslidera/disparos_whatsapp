"use client";

/** Armazenamento de anexos de campanhas agendadas (IndexedDB), para sobreviver ao recarregamento da página. */

const DB_NAME = "disparos";
const STORE = "scheduled-attachments";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") return reject(new Error("IndexedDB indisponível"));
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error("Falha ao abrir o IndexedDB"));
  });
}

function tx<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(STORE, mode);
        const req = fn(t.objectStore(STORE));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error || new Error("Falha no IndexedDB"));
        t.oncomplete = () => db.close();
      }),
  );
}

export function idbPut<T>(key: string, value: T): Promise<void> {
  return tx("readwrite", (s) => s.put(value, key)).then(() => undefined);
}

export function idbGet<T>(key: string): Promise<T | undefined> {
  return tx<T | undefined>("readonly", (s) => s.get(key) as IDBRequest<T | undefined>);
}

export function idbDelete(key: string): Promise<void> {
  return tx("readwrite", (s) => s.delete(key)).then(() => undefined);
}
