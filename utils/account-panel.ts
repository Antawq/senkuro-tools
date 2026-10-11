import type { AccountSnapshot } from './account-cache';
import type { AccountCard } from './account-cards';
import { summarizeAccount, type AccountSummary } from './account-summary';
import type { Database } from './database';
import { ApiError } from './graphql';
import { formatAmount } from './trade-value';

export interface PanelDeps {
  readToken: () => Promise<string | null>;
  fetchCards: (token: string, onProgress: (loaded: number) => void) => Promise<AccountCard[]>;
  loadDatabase: () => Promise<Database>;
  loadSnapshot: () => Promise<AccountSnapshot | null>;
  saveSnapshot: (cards: AccountCard[], at: number) => Promise<void>;
  clearSnapshot: () => Promise<void>;
  commission: () => boolean;
  now: () => number;
}

export interface AccountPanel {
  ready: Promise<void>;
  refresh(): Promise<void>;
}

const IDLE_HINT = 'Запрос уходит только на api.senkuro.com с токеном вашего аккаунта и только по нажатию кнопки. Карты оцениваются по базе расширения.';
const NO_TOKEN = 'Не найден токен: войдите в аккаунт на сайте и повторите.';
const LOAD = 'Показать';
const RELOAD = 'Обновить';
const BUSY = 'Загрузка…';

const IDS = [
  'accountStats',
  'accountCards',
  'accountCardsNote',
  'accountBank',
  'accountBankNote',
  'accountR',
  'accountRCards',
  'accountRCoins',
  'accountRNote',
  'accountHint',
  'accountLoad',
  'accountClear',
] as const;

type Id = (typeof IDS)[number];

const groupDigits = (digits: string): string => digits.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

export const formatCount = (count: number): string => groupDigits(String(Math.round(count)));

export function formatCoins(coins: number): string {
  const [whole = '0', fraction] = formatAmount(coins).split('.');
  return fraction ? `${groupDigits(whole)}.${fraction}` : groupDigits(whole);
}

export function ago(then: number, now: number): string {
  const minutes = Math.floor(Math.max(0, now - then) / 60_000);
  if (minutes < 1) return 'только что';
  if (minutes < 60) return `${minutes} мин назад`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours} ч назад` : `${Math.floor(hours / 24)} дн назад`;
}

export function messageFor(error: unknown): string {
  if (!(error instanceof ApiError)) return 'Не удалось загрузить: попробуйте позже.';
  if (error.unauthorized) return 'Сайт не принял токен: войдите в аккаунт заново.';
  if (error.failure === 'redirect') return 'Сайт ответил перенаправлением, запрос остановлен.';
  if (error.failure === 'limit') return 'Слишком много карт для одного запроса.';
  return `Не удалось загрузить${error.status ? ` (HTTP ${error.status})` : ''}: попробуйте позже.`;
}

const joined = (parts: (string | false)[]): string => parts.filter(Boolean).join(' · ');

const cardsNote = ({ unique, shards, unpriced }: AccountSummary): string =>
  joined([`уникальных ${formatCount(unique)}`, shards > 0 && `осколков ${formatCount(shards)}`, unpriced > 0 && `без цены ${formatCount(unpriced)}`]);

const bankNote = ({ bankByRank }: AccountSummary): string => (bankByRank.length > 0 ? `по рангам: ${bankByRank.join(' · ')}` : '');

const rNote = (shards: number): string => (shards > 0 ? `Осколков: ${formatCount(shards)} (не оцениваются)` : 'Считается отдельно от банка');

function find(root: ParentNode): Record<Id, HTMLElement> | null {
  const found = {} as Record<Id, HTMLElement>;
  for (const id of IDS) {
    const element = root.querySelector<HTMLElement>(`#${id}`);
    if (!element) return null;
    found[id] = element;
  }
  return found;
}

export function mountAccountPanel(root: ParentNode, deps: PanelDeps): AccountPanel {
  const found = find(root);
  if (!found) return { ready: Promise.resolve(), refresh: async () => undefined };
  const ui: Record<Id, HTMLElement> = found;
  const load = ui.accountLoad as HTMLButtonElement;
  const clear = ui.accountClear as HTMLButtonElement;
  let snapshot: AccountSnapshot | null = null;
  let loading = false;

  const setHint = (text: string, error = false) => {
    ui.accountHint.textContent = text;
    ui.accountHint.classList.toggle('hint--error', error);
  };

  const setNote = (element: HTMLElement, text: string) => {
    element.textContent = text;
    element.hidden = text === '';
  };

  async function show(): Promise<void> {
    if (!snapshot) {
      ui.accountStats.hidden = true;
      clear.hidden = true;
      load.textContent = LOAD;
      setHint(IDLE_HINT);
      return;
    }
    const summary = summarizeAccount(snapshot.cards, await deps.loadDatabase(), deps.commission());
    ui.accountCards.textContent = formatCount(summary.cards);
    setNote(ui.accountCardsNote, cardsNote(summary));
    ui.accountBank.textContent = formatCoins(summary.bank);
    setNote(ui.accountBankNote, bankNote(summary));
    ui.accountR.hidden = summary.r === null;
    if (summary.r) {
      ui.accountRCards.textContent = formatCount(summary.r.cards);
      ui.accountRCoins.textContent = formatCoins(summary.r.coins);
      ui.accountRNote.textContent = rNote(summary.r.shards);
    }
    ui.accountStats.hidden = false;
    clear.hidden = false;
    load.textContent = RELOAD;
    setHint(`Обновлено ${ago(snapshot.at, deps.now())}. Данные хранятся только в этом браузере.`);
  }

  async function fetchAll(): Promise<void> {
    if (loading) return;
    loading = true;
    load.disabled = true;
    clear.disabled = true;
    load.textContent = BUSY;
    setHint('Читаю токен…');
    try {
      const token = await deps.readToken();
      if (!token) {
        setHint(NO_TOKEN, true);
        return;
      }
      const cards = await deps.fetchCards(token, (loaded) => setHint(`Загружено записей: ${formatCount(loaded)}`));
      const at = deps.now();
      await deps.saveSnapshot(cards, at);
      snapshot = { at, cards };
      await show();
    } catch (error) {
      setHint(messageFor(error), true);
    } finally {
      loading = false;
      load.disabled = false;
      clear.disabled = false;
      load.textContent = snapshot ? RELOAD : LOAD;
    }
  }

  async function forget(): Promise<void> {
    await deps.clearSnapshot();
    snapshot = null;
    await show();
  }

  load.addEventListener('click', () => void fetchAll());
  clear.addEventListener('click', () => void forget());

  const ready = deps
    .loadSnapshot()
    .catch(() => null)
    .then((stored) => {
      snapshot = stored;
      return show();
    });

  return { ready, refresh: show };
}
