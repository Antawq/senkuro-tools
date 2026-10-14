import { browser } from 'wxt/browser';

import { DATABASE_FILE } from './assets';

export interface CardEntry {
  price: number;
  name: string;
  rank: string;
  manga?: string;
}

export type Database = Partial<Record<string, CardEntry>>;

let loading: Promise<Database> | null = null;

async function request(): Promise<Database> {
  const response = await fetch(browser.runtime.getURL(`/${DATABASE_FILE}`));
  if (!response.ok) throw new Error(`${DATABASE_FILE}: HTTP ${response.status}`);
  return (await response.json()) as Database;
}

export function loadDatabase(): Promise<Database> {
  loading ??= request().catch((error: unknown) => {
    loading = null;
    console.error(`SenkuTools: ${DATABASE_FILE}`, error);
    return {};
  });
  return loading;
}
