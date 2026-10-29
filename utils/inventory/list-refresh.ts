import { parseJson } from '../shared/json';
import { FAST_PAGES, delayForPage } from '../shared/paging';
import { linked, readRawPage, type Family, type ListRecord, type PageRequest, type RawPage } from './list-families';

export const REFRESH_POLICY = 'network-only';
export const MAX_FILL_ROUNDS = 10;

type Fetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export interface PageClient {
  query(document: unknown, variables: Record<string, unknown>, context?: Record<string, unknown>): { toPromise(): Promise<unknown> };
}

export interface RefreshEnv {
  client: PageClient;
  fetch: Fetch;
  silent: WeakSet<object>;
  record: ListRecord;
  sleep: (delayMs: number) => Promise<void>;
}

export interface RefreshReport {
  requests: number;
  failed: boolean;
}

interface Run extends RefreshEnv {
  requests: number;
}

interface Boundary {
  page: PageRequest;
  raw: RawPage | null;
  next: PageRequest;
  nextRaw: RawPage | null;
}

interface SentPage {
  answer: Promise<unknown> | null;
  raw: RawPage | null;
}

async function requestPage(run: Run, page: PageRequest): Promise<SentPage> {
  const sent: SentPage = { answer: null, raw: null };
  const capture: Fetch = (input, init) => {
    run.requests += 1;
    const answer = run.fetch(input, init).then(async (response) => {
      sent.raw = readRawPage(parseJson(await response.clone().text())) ?? sent.raw;
      return response;
    });
    sent.answer = answer;
    return answer;
  };
  run.silent.add(capture);
  const result = (await run.client.query(page.document, page.variables, { ...page.options, requestPolicy: REFRESH_POLICY, fetch: capture }).toPromise()) as
    { error?: unknown } | undefined;
  if (result?.error) throw new Error('list refresh failed');
  await sent.answer?.catch(() => undefined);
  return sent;
}

async function fetchPage(run: Run, page: PageRequest): Promise<RawPage | null> {
  const sent = await requestPage(run, page);
  return sent.answer ? sent.raw : (await requestPage(run, page)).raw;
}

async function fillBoundary(run: Run, family: Family, boundary: Boundary): Promise<PageRequest[]> {
  const added: PageRequest[] = [];
  let raw = boundary.raw;
  for (let round = 0; round < MAX_FILL_ROUNDS; round++) {
    if (!raw || !boundary.nextRaw || !raw.hasNextPage || !raw.endCursor || linked(raw, boundary.next.variables.after, boundary.nextRaw)) break;
    const page = { ...boundary.page, variables: { ...family.filters, after: raw.endCursor } };
    raw = await fetchPage(run, page);
    added.push(page);
  }
  return added;
}

async function fetchPages(run: Run, pages: PageRequest[]): Promise<(RawPage | null)[]> {
  const raws = await Promise.all(pages.slice(0, FAST_PAGES).map((page) => fetchPage(run, page)));
  for (const [index, page] of pages.slice(FAST_PAGES).entries()) {
    await run.sleep(delayForPage(FAST_PAGES + index));
    raws.push(await fetchPage(run, page));
  }
  return raws;
}

async function refreshFamily(run: Run, family: Family): Promise<void> {
  const pages = [...family.pages];
  const raws = await fetchPages(run, pages);
  const filled: PageRequest[][] = [];
  for (const [index, page] of pages.entries()) {
    const next = pages[index + 1];
    filled.push(next ? await fillBoundary(run, family, { page, raw: raws[index] ?? null, next, nextRaw: raws[index + 1] ?? null }) : []);
  }
  filled.forEach((added, index) => {
    const anchor = pages[index];
    if (anchor) run.record.insertAfter(family, anchor, added);
  });
}

export async function refreshFamilies(env: RefreshEnv, families: Family[]): Promise<RefreshReport> {
  const run: Run = { ...env, requests: 0 };
  try {
    for (const family of families) await refreshFamily(run, family);
  } catch {
    return { requests: run.requests, failed: true };
  }
  return { requests: run.requests, failed: false };
}
