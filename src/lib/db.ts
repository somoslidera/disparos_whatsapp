import { promises as fs } from "node:fs";
import path from "node:path";
import type { Database } from "./types";

export const DATA_DIR = path.resolve(/*turbopackIgnore: true*/ process.env.DATA_DIR || "data");
export const UPLOAD_DIR = path.join(DATA_DIR, "uploads");
const DB_FILE = path.join(DATA_DIR, "db.json");

const EMPTY: Database = { audiences: [], campaigns: [] };

type Store = {
  cache: Database | null;
  writing: Promise<void>;
};

// Mantém o cache entre recarregamentos (HMR) no modo dev.
const g = globalThis as unknown as { __disparosStore?: Store };
const store: Store = g.__disparosStore ?? { cache: null, writing: Promise.resolve() };
g.__disparosStore = store;

async function ensureDirs() {
  await fs.mkdir(UPLOAD_DIR, { recursive: true });
}

export async function readDb(): Promise<Database> {
  if (store.cache) return store.cache;
  await ensureDirs();
  try {
    const raw = await fs.readFile(DB_FILE, "utf8");
    const parsed = JSON.parse(raw) as Partial<Database>;
    store.cache = {
      audiences: Array.isArray(parsed.audiences) ? parsed.audiences : [],
      campaigns: Array.isArray(parsed.campaigns) ? parsed.campaigns : [],
    };
  } catch {
    store.cache = structuredClone(EMPTY);
  }
  return store.cache;
}

export async function writeDb(db: Database): Promise<void> {
  store.cache = db;
  // Serializa as escritas para evitar corrupção do arquivo.
  store.writing = store.writing.then(async () => {
    await ensureDirs();
    const tmp = `${DB_FILE}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(db, null, 2), "utf8");
    await fs.rename(tmp, DB_FILE);
  });
  return store.writing;
}

export async function updateDb<T>(fn: (db: Database) => T | Promise<T>): Promise<T> {
  const db = await readDb();
  const result = await fn(db);
  await writeDb(db);
  return result;
}
