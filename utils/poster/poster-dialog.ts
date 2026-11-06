import { PRICE_DECIMALS, effectivePrice } from '../shared/cards';
import type { Database } from '../shared/database';
import { element, writeAttribute } from '../shared/dom';
import type { Settings } from '../shared/settings';
import { closeIcon } from '../shared/svg';
import { UNKNOWN_MARK } from '../shared/trade-value';
import type { ArchiveEntry } from './poster-archive';
import type { PosterArt } from './poster-art';
import type { SelectedCard } from './poster-cards';
import { splitIntoPages } from './poster-pages';
import { createPager, syncPager, type PagerControls } from './poster-pager';
import type { PosterContent } from './poster-render';

export const POSTER_TEXT = {
  title: 'Постер',
  imageAlt: 'Превью постера',
  heading: 'Заголовок',
  headingPlaceholder: 'Например: Меняю',
  nickname: 'Ник',
  quantity: 'Количество',
  prices: 'Цены',
  download: 'Скачать PNG',
  downloadAll: 'Скачать все страницы (ZIP)',
  copy: 'Копировать',
  close: 'Закрыть',
  previousPage: 'Предыдущая страница',
  nextPage: 'Следующая страница',
  loading: 'Загружаю карты',
  copied: 'Скопировано',
  copyFailed: 'Не удалось скопировать',
  artFailed: 'Не удалось получить картинки карт',
  renderFailed: 'Не удалось собрать картинку',
  archiveFailed: 'Не удалось собрать архив',
  nicknameFailed: 'Не удалось получить ник',
  nothingToDraw: 'Нет карт для постера',
  imagesFailed: (count: number): string => `Не загрузились картинки: ${count}`,
  position: (page: number, total: number): string => `Страница ${page} из ${total}`,
  archiving: (page: number, total: number): string => `Собираю архив: ${page} из ${total}`,
} as const;

export const DIALOG_CLASS = 'senkutools-poster';

const DOWNLOAD_BUTTON = 'button button--accent button--fluid button-size--lg';
const COPY_BUTTON = 'button button--secondary button--fluid button-size--lg';
const CLOSE_BUTTON = 'button button--secondary button--icon button-size--md';
const CLOSE_ICON_SIZE_PX = 20;
const HEADING_MAX_LENGTH = 60;
const NOTE_SEPARATOR = ' · ';
const FILE_NAME_UNSAFE = /[^a-z0-9_-]+/gi;
const FILE_NAME_EDGES = /^-+|-+$/g;
const FILE_NAME_FALLBACK = 'poster';

export interface PosterDialogHost {
  pageDocument: Document;
  database: Database;
  settings: Pick<Settings, 'commission'>;
  fetchArt: (slugs: readonly string[], signal: AbortSignal) => Promise<Map<string, PosterArt>>;
  loadImage: (art: PosterArt) => Promise<ImageBitmap>;
  fetchNickname: (slug: string, signal: AbortSignal) => Promise<string | null>;
  render: (content: PosterContent) => Promise<Blob>;
  pack: (entries: readonly ArchiveEntry[]) => Promise<Blob>;
  nextFrame: (run: () => void) => void;
  download: (blob: Blob, fileName: string) => void;
  copyImage: (blob: Blob) => Promise<void>;
}

type NoteKind = 'status' | 'nickname' | 'render' | 'copy' | 'archive';

interface DialogControls {
  dialog: HTMLDialogElement;
  image: HTMLImageElement;
  heading: HTMLInputElement;
  nickname: HTMLInputElement;
  quantity: HTMLInputElement;
  prices: HTMLInputElement;
  note: HTMLElement;
  download: HTMLButtonElement;
  copy: HTMLButtonElement;
  downloadAll: HTMLButtonElement | null;
  pager: PagerControls | null;
  close: HTMLButtonElement;
}

interface ShownCard extends SelectedCard {
  image: ImageBitmap | null;
}

interface ContentSettings {
  heading: string;
  nickname: string | null;
  shouldShowQuantity: boolean;
  shouldShowPrices: boolean;
}

interface PageRef {
  number: number;
  total: number;
}

interface PosterSession {
  host: PosterDialogHost;
  controls: DialogControls;
  profileSlug: string;
  pages: readonly (readonly SelectedCard[])[];
  pageIndex: number;
  shown: readonly ShownCard[];
  arts: Map<string, PosterArt>;
  notes: Map<NoteKind, string>;
  abort: AbortController;
  nickname: string | null;
  blob: Blob | null;
  imageUrl: string | null;
  latestRender: symbol | null;
  hasNicknameRequest: boolean;
  isReady: boolean;
  isBusy: boolean;
  isFrameQueued: boolean;
  isClosed: boolean;
}

function createToggle(name: string, caption: string, isChecked: boolean): { label: HTMLLabelElement; input: HTMLInputElement } {
  const input = element('input', `${DIALOG_CLASS}__${name}`);
  input.type = 'checkbox';
  input.checked = isChecked;
  const label = element('label', `${DIALOG_CLASS}__toggle`);
  label.append(input, element('span', undefined, caption));
  return { label, input };
}

function createHeadingField(): { label: HTMLLabelElement; input: HTMLInputElement } {
  const input = element('input', `${DIALOG_CLASS}__heading`);
  input.type = 'text';
  input.maxLength = HEADING_MAX_LENGTH;
  input.autocomplete = 'off';
  input.placeholder = POSTER_TEXT.headingPlaceholder;
  const label = element('label', `${DIALOG_CLASS}__field`);
  label.append(element('span', undefined, POSTER_TEXT.heading), input);
  return { label, input };
}

function createButton(className: string, name: string, text?: string): HTMLButtonElement {
  const button = element('button', `${className} ${DIALOG_CLASS}__${name}`, text);
  button.type = 'button';
  return button;
}

function createCloseButton(): HTMLButtonElement {
  const button = createButton(CLOSE_BUTTON, 'close');
  button.setAttribute('aria-label', POSTER_TEXT.close);
  const icon = closeIcon(CLOSE_ICON_SIZE_PX);
  icon.setAttribute('aria-hidden', 'true');
  button.append(icon);
  return button;
}

function createPreview(image: HTMLImageElement, pager: PagerControls | null): HTMLElement {
  const preview = element('div', `${DIALOG_CLASS}__preview`);
  preview.append(image);
  if (pager) {
    preview.classList.add(`${DIALOG_CLASS}__preview--paged`);
    preview.append(pager.root);
  }
  return preview;
}

function createActionRows(download: HTMLButtonElement, copy: HTMLButtonElement, downloadAll: HTMLButtonElement | null): HTMLElement[] {
  const mainRow = element('div', `${DIALOG_CLASS}__actions`);
  mainRow.append(download, copy);
  if (!downloadAll) return [mainRow];
  const allRow = element('div', `${DIALOG_CLASS}__actions`);
  allRow.append(downloadAll);
  return [mainRow, allRow];
}

function createControls(pageCount: number): DialogControls {
  const dialog = element('dialog', DIALOG_CLASS);
  dialog.setAttribute('aria-label', POSTER_TEXT.title);
  const image = element('img', `${DIALOG_CLASS}__image`);
  image.alt = POSTER_TEXT.imageAlt;
  const isPaged = pageCount > 1;
  const pager = isPaged ? createPager({ previous: POSTER_TEXT.previousPage, next: POSTER_TEXT.nextPage }) : null;
  const heading = createHeadingField();
  const nickname = createToggle('nickname', POSTER_TEXT.nickname, true);
  const quantity = createToggle('quantity', POSTER_TEXT.quantity, true);
  const prices = createToggle('prices', POSTER_TEXT.prices, false);
  const note = element('p', `${DIALOG_CLASS}__note`);
  note.setAttribute('role', 'status');
  const download = createButton(DOWNLOAD_BUTTON, 'download', POSTER_TEXT.download);
  const copy = createButton(COPY_BUTTON, 'copy', POSTER_TEXT.copy);
  const downloadAll = isPaged ? createButton(COPY_BUTTON, 'download-all', POSTER_TEXT.downloadAll) : null;
  const form = element('form', `${DIALOG_CLASS}__controls`);
  form.addEventListener('submit', (event) => event.preventDefault());
  form.append(heading.label, nickname.label, quantity.label, prices.label, note, ...createActionRows(download, copy, downloadAll));
  const body = element('div', `${DIALOG_CLASS}__body`);
  body.append(createPreview(image, pager), form);
  const close = createCloseButton();
  dialog.append(body, close);
  return {
    dialog,
    image,
    heading: heading.input,
    nickname: nickname.input,
    quantity: quantity.input,
    prices: prices.input,
    note,
    download,
    copy,
    downloadAll,
    pager,
    close,
  };
}

function setNote(session: PosterSession, kind: NoteKind, text: string | null): void {
  if (text === null) session.notes.delete(kind);
  else session.notes.set(kind, text);
  session.controls.note.textContent = [...session.notes.values()].join(NOTE_SEPARATOR);
}

function syncControls(session: PosterSession): void {
  const { controls, pageIndex, pages } = session;
  for (const button of [controls.download, controls.copy]) writeAttribute(button, 'aria-disabled', session.blob ? null : 'true');
  if (controls.downloadAll) writeAttribute(controls.downloadAll, 'aria-disabled', session.isBusy || !session.isReady ? 'true' : null);
  if (controls.pager) {
    syncPager(controls.pager, {
      position: POSTER_TEXT.position(pageIndex + 1, pages.length),
      hasPrevious: !session.isBusy && pageIndex > 0,
      hasNext: !session.isBusy && pageIndex < pages.length - 1,
    });
  }
}

const baseNameOf = (profileSlug: string): string => {
  const safeSlug = profileSlug.replace(FILE_NAME_UNSAFE, '-').replace(FILE_NAME_EDGES, '');
  return `senkutools-poster-${safeSlug || FILE_NAME_FALLBACK}`;
};

const pageSuffixOf = (page: PageRef | undefined): string => (page ? `-${String(page.number).padStart(String(page.total).length, '0')}` : '');

export const fileNameOf = (profileSlug: string, page?: PageRef): string => `${baseNameOf(profileSlug)}${pageSuffixOf(page)}.png`;

export const archiveNameOf = (profileSlug: string): string => `${baseNameOf(profileSlug)}.zip`;

const pageRefOf = (session: PosterSession, index: number): PageRef | undefined =>
  session.pages.length > 1 ? { number: index + 1, total: session.pages.length } : undefined;

function priceTextOf(slug: string, host: PosterDialogHost): string {
  const entry = host.database[slug];
  return entry ? effectivePrice(entry.price, host.settings.commission).toFixed(PRICE_DECIMALS) : UNKNOWN_MARK;
}

function settingsOf(session: PosterSession): ContentSettings {
  const { controls } = session;
  return {
    heading: controls.heading.value,
    nickname: controls.nickname.checked ? session.nickname : null,
    shouldShowQuantity: controls.quantity.checked,
    shouldShowPrices: controls.prices.checked,
  };
}

function contentOf(settings: ContentSettings, cards: readonly ShownCard[], host: PosterDialogHost): PosterContent {
  return {
    cards: cards.map((card) => ({
      selected: { slug: card.slug, quantity: card.quantity },
      image: card.image,
      priceText: settings.shouldShowPrices ? priceTextOf(card.slug, host) : null,
    })),
    heading: settings.heading,
    nickname: settings.nickname,
    shouldShowQuantity: settings.shouldShowQuantity,
  };
}

function showBlob(session: PosterSession, blob: Blob): void {
  if (session.imageUrl) URL.revokeObjectURL(session.imageUrl);
  session.imageUrl = URL.createObjectURL(blob);
  session.blob = blob;
  session.controls.image.src = session.imageUrl;
  syncControls(session);
}

async function runRender(session: PosterSession): Promise<void> {
  const render = Symbol('render');
  session.latestRender = render;
  const isStale = (): boolean => session.isClosed || session.latestRender !== render;
  setNote(session, 'copy', null);
  try {
    const blob = await session.host.render(contentOf(settingsOf(session), session.shown, session.host));
    if (isStale()) return;
    setNote(session, 'render', null);
    showBlob(session, blob);
  } catch {
    if (isStale()) return;
    session.blob = null;
    syncControls(session);
    setNote(session, 'render', POSTER_TEXT.renderFailed);
  }
}

function scheduleRender(session: PosterSession): void {
  if (session.isClosed || !session.isReady || session.isFrameQueued) return;
  session.isFrameQueued = true;
  session.host.nextFrame(() => {
    session.isFrameQueued = false;
    void runRender(session);
  });
}

const closeImages = (cards: readonly ShownCard[]): void => {
  for (const card of cards) card.image?.close();
};

async function fetchMissingArt(session: PosterSession, page: readonly SelectedCard[]): Promise<void> {
  const missing = [...new Set(page.map((card) => card.slug))].filter((slug) => !session.arts.has(slug));
  if (missing.length === 0) return;
  const arts = await session.host.fetchArt(missing, session.abort.signal);
  arts.forEach((art, slug) => session.arts.set(slug, art));
}

function loadCardImage(session: PosterSession, slug: string): Promise<ImageBitmap | null> {
  const art = session.arts.get(slug);
  return art ? session.host.loadImage(art).catch(() => null) : Promise.resolve(null);
}

async function loadCards(session: PosterSession, page: readonly SelectedCard[]): Promise<ShownCard[]> {
  await fetchMissingArt(session, page);
  const cards = await Promise.all(page.map(async (card) => ({ ...card, image: await loadCardImage(session, card.slug) })));
  if (session.isClosed) closeImages(cards);
  return cards;
}

function startPageLoad(session: PosterSession, index: number): void {
  closeImages(session.shown);
  session.shown = [];
  session.pageIndex = index;
  session.blob = null;
  session.isReady = false;
  session.isBusy = true;
  syncControls(session);
  setNote(session, 'status', POSTER_TEXT.loading);
}

async function loadPage(session: PosterSession, index: number, page: readonly SelectedCard[]): Promise<void> {
  startPageLoad(session, index);
  let cards: ShownCard[];
  try {
    cards = await loadCards(session, page);
  } catch {
    if (session.isClosed) return;
    setNote(session, 'status', POSTER_TEXT.artFailed);
    session.isBusy = false;
    syncControls(session);
    return;
  }
  if (session.isClosed) return;
  const failedCount = cards.filter((card) => card.image === null).length;
  session.shown = cards;
  session.isReady = true;
  session.isBusy = false;
  setNote(session, 'status', failedCount > 0 ? POSTER_TEXT.imagesFailed(failedCount) : null);
  syncControls(session);
  scheduleRender(session);
}

function goToPage(session: PosterSession, index: number): void {
  const page = session.pages[index];
  if (!page || session.isBusy || session.isClosed) return;
  void loadPage(session, index, page);
}

function requestNickname(session: PosterSession): void {
  if (session.hasNicknameRequest || session.isClosed) return;
  session.hasNicknameRequest = true;
  const finish = (nickname: string | null): void => {
    if (session.isClosed) return;
    session.nickname = nickname;
    setNote(session, 'nickname', nickname === null ? POSTER_TEXT.nicknameFailed : null);
    scheduleRender(session);
  };
  session.host.fetchNickname(session.profileSlug, session.abort.signal).then(finish, () => finish(null));
}

function pressDownload(session: PosterSession): void {
  if (session.blob) session.host.download(session.blob, fileNameOf(session.profileSlug, pageRefOf(session, session.pageIndex)));
}

async function pressCopy(session: PosterSession): Promise<void> {
  if (!session.blob) return;
  try {
    await session.host.copyImage(session.blob);
    setNote(session, 'copy', POSTER_TEXT.copied);
  } catch {
    setNote(session, 'copy', POSTER_TEXT.copyFailed);
  }
}

async function renderPage(session: PosterSession, index: number, page: readonly SelectedCard[], settings: ContentSettings): Promise<Blob> {
  if (index === session.pageIndex) return session.host.render(contentOf(settings, session.shown, session.host));
  const cards = await loadCards(session, page);
  try {
    return await session.host.render(contentOf(settings, cards, session.host));
  } finally {
    closeImages(cards);
  }
}

async function renderEveryPage(session: PosterSession, settings: ContentSettings): Promise<ArchiveEntry[]> {
  const entries: ArchiveEntry[] = [];
  for (const [index, page] of session.pages.entries()) {
    if (session.isClosed) break;
    setNote(session, 'archive', POSTER_TEXT.archiving(index + 1, session.pages.length));
    const blob = await renderPage(session, index, page, settings);
    entries.push({ name: fileNameOf(session.profileSlug, pageRefOf(session, index)), blob });
  }
  return entries;
}

async function pressDownloadAll(session: PosterSession): Promise<void> {
  if (session.isBusy || !session.isReady || session.isClosed) return;
  session.isBusy = true;
  syncControls(session);
  try {
    const entries = await renderEveryPage(session, settingsOf(session));
    if (session.isClosed) return;
    const archive = await session.host.pack(entries);
    if (session.isClosed) return;
    setNote(session, 'archive', null);
    session.host.download(archive, archiveNameOf(session.profileSlug));
  } catch {
    if (!session.isClosed) setNote(session, 'archive', POSTER_TEXT.archiveFailed);
  } finally {
    session.isBusy = false;
    if (!session.isClosed) syncControls(session);
  }
}

function teardown(session: PosterSession): void {
  session.isClosed = true;
  session.abort.abort();
  if (session.imageUrl) URL.revokeObjectURL(session.imageUrl);
  closeImages(session.shown);
  session.controls.dialog.remove();
}

function bindControls(session: PosterSession): void {
  const { controls } = session;
  controls.heading.addEventListener('input', () => scheduleRender(session));
  for (const toggle of [controls.quantity, controls.prices]) toggle.addEventListener('change', () => scheduleRender(session));
  controls.nickname.addEventListener('change', () => {
    if (controls.nickname.checked) requestNickname(session);
    scheduleRender(session);
  });
  controls.download.addEventListener('click', () => pressDownload(session));
  controls.copy.addEventListener('click', () => void pressCopy(session));
  controls.downloadAll?.addEventListener('click', () => void pressDownloadAll(session));
  controls.pager?.previous.addEventListener('click', () => goToPage(session, session.pageIndex - 1));
  controls.pager?.next.addEventListener('click', () => goToPage(session, session.pageIndex + 1));
  controls.close.addEventListener('click', () => controls.dialog.close());
  controls.dialog.addEventListener('close', () => teardown(session));
}

function createSession(pages: readonly (readonly SelectedCard[])[], profileSlug: string, host: PosterDialogHost): PosterSession {
  return {
    host,
    controls: createControls(pages.length),
    profileSlug,
    pages,
    pageIndex: 0,
    shown: [],
    arts: new Map(),
    notes: new Map(),
    abort: new AbortController(),
    nickname: null,
    blob: null,
    imageUrl: null,
    latestRender: null,
    hasNicknameRequest: false,
    isReady: false,
    isBusy: false,
    isFrameQueued: false,
    isClosed: false,
  };
}

export function closePosterDialogs(pageDocument: Document): void {
  pageDocument.querySelectorAll<HTMLDialogElement>(`dialog.${DIALOG_CLASS}`).forEach((dialog) => dialog.close());
}

export function closeStalePosterDialogs(pageDocument: Document): void {
  const { pathname } = pageDocument.location;
  pageDocument.querySelectorAll<HTMLDialogElement>(`dialog.${DIALOG_CLASS}`).forEach((dialog) => {
    if (dialog.dataset.senkutoolsPath !== pathname) dialog.close();
  });
}

export function openPosterDialog(cards: readonly SelectedCard[], profileSlug: string, host: PosterDialogHost): void {
  closePosterDialogs(host.pageDocument);
  const pages = splitIntoPages(cards);
  const session = createSession(pages, profileSlug, host);
  syncControls(session);
  bindControls(session);
  session.controls.dialog.dataset.senkutoolsPath = host.pageDocument.location.pathname;
  host.pageDocument.body.append(session.controls.dialog);
  session.controls.dialog.showModal();
  const [firstPage] = pages;
  if (!firstPage) {
    setNote(session, 'status', POSTER_TEXT.nothingToDraw);
    return;
  }
  if (session.controls.nickname.checked) requestNickname(session);
  void loadPage(session, 0, firstPage);
}
