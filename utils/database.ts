import { browser } from 'wxt/browser';

export interface CardEntry {
  price: number;
  name: string;
  rank: string;
  manga?: string;
}

export type Database = Partial<Record<string, CardEntry>>;

let loading: Promise<Database> | null = null;
let cached: Database | null = null;

async function request(): Promise<Database> {
  const response = await fetch(browser.runtime.getURL('/database.json'));
  if (!response.ok) throw new Error(`database.json: HTTP ${response.status}`);
  return (await response.json()) as Database;
}

export function loadDatabase(): Promise<Database> {
  if (cached) return Promise.resolve(cached);
  loading ??= request()
    .then((db) => {
      cached = db;
      return db;
    })
    .catch((error: unknown) => {
      console.error('SenkuTools: database.json', error);
      return {};
    })
    .finally(() => {
      loading = null;
    });
  return loading;
}
