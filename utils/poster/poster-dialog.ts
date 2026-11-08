import { PRICE_DECIMALS, effectivePrice } from '../shared/cards';
import type { Database } from '../shared/database';
import type { Settings } from '../shared/settings';
import { UNKNOWN_MARK } from '../shared/trade-value';
import type { ArchiveEntry } from './poster-archive';
import type { PosterArt } from './poster-art';
import type { SelectedCard } from './poster-cards';
import { DIALOG_CLASS, POSTER_TEXT, archiveNameOf, createControls, fileNameOf, syncDialogControls, type DialogControls, type PageRef } from './poster-controls';
import { splitIntoPages } from './poster-pages';
import type { PosterContent } from './poster-render';

export { DIALOG_CLASS, POSTER_TEXT, archiveNameOf, fileNameOf };

const NOTE_SEPARATOR = ' · ';

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

interface ShownCard extends SelectedCard {
  image: ImageBitmap | null;
}

interface ContentSettings {
  heading: string;
  nickname: string | null;
  shouldShowQuantity: boolean;
  shouldShowPrices: boolean;
}

interface RenderedPage {
  blob: Blob;
  missingImageCount: number;
}

interface RenderedPages {
  entries: ArchiveEntry[];
  missingImageCount: number;
}

interface BuiltArchive {
  archive: Blob;
  missingImageCount: number;
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
  nicknameTask: Promise<void> | null;
  blob: Blob | null;
  imageUrl: string | null;
  latestRender: symbol | null;
  hasNicknameRequest: boolean;
  isReady: boolean;
  isBusy: boolean;
  isFrameQueued: boolean;
  isClosed: boolean;
}

function setNote(session: PosterSession, kind: NoteKind, text: string | null): void {
  if (text === null) session.notes.delete(kind);
  else session.notes.set(kind, text);
  session.controls.note.textContent = [...session.notes.values()].join(NOTE_SEPARATOR);
}

function syncControls(session: PosterSession): void {
  syncDialogControls(session.controls, {
    hasBlob: session.blob !== null,
    isReady: session.isReady,
    isBusy: session.isBusy,
    pageIndex: session.pageIndex,
    pageCount: session.pages.length,
  });
}

const pageRefOf = (session: PosterSession, index: number): PageRef | undefined =>
  session.pages.length > 1 ? { number: index + 1, count: session.pages.length } : undefined;

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

function contentOf(settings: ContentSettings, cards: readonly ShownCard[], session: PosterSession): PosterContent {
  return {
    cards: cards.map((card) => ({
      selected: card.shard ? { slug: card.slug, quantity: card.quantity, shard: true } : { slug: card.slug, quantity: card.quantity },
      image: card.image,
      priceText: settings.shouldShowPrices ? priceTextOf(card.slug, session.host) : null,
      rank: session.arts.get(card.slug)?.rank ?? session.host.database[card.slug]?.rank,
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
    const blob = await session.host.render(contentOf(settingsOf(session), session.shown, session));
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
    if (session.isReady && !session.isClosed) void runRender(session);
  });
}

const closeImages = (cards: readonly ShownCard[]): void => {
  for (const card of cards) card.image?.close();
};

const countMissingImages = (cards: readonly ShownCard[]): number => cards.filter((card) => card.image === null).length;

function clearPreview(session: PosterSession): void {
  if (session.imageUrl) URL.revokeObjectURL(session.imageUrl);
  session.imageUrl = null;
  session.controls.image.removeAttribute('src');
}

async function fetchMissingArt(session: PosterSession, pageCards: readonly SelectedCard[]): Promise<void> {
  const missing = [...new Set(pageCards.map((card) => card.slug))].filter((slug) => !session.arts.has(slug));
  if (missing.length === 0) return;
  const arts = await session.host.fetchArt(missing, session.abort.signal);
  arts.forEach((art, slug) => session.arts.set(slug, art));
}

function loadCardImage(session: PosterSession, slug: string): Promise<ImageBitmap | null> {
  const art = session.arts.get(slug);
  return art ? session.host.loadImage(art).catch(() => null) : Promise.resolve(null);
}

async function loadCards(session: PosterSession, pageCards: readonly SelectedCard[]): Promise<ShownCard[]> {
  await fetchMissingArt(session, pageCards);
  const cards = await Promise.all(pageCards.map(async (card) => ({ ...card, image: await loadCardImage(session, card.slug) })));
  if (session.isClosed) closeImages(cards);
  return cards;
}

function startPageLoad(session: PosterSession): void {
  closeImages(session.shown);
  session.shown = [];
  session.blob = null;
  session.latestRender = null;
  session.isReady = false;
  session.isBusy = true;
  syncControls(session);
  setNote(session, 'archive', null);
  setNote(session, 'status', POSTER_TEXT.loading);
}

async function loadPage(session: PosterSession, pageCards: readonly SelectedCard[]): Promise<void> {
  startPageLoad(session);
  let cards: ShownCard[];
  try {
    cards = await loadCards(session, pageCards);
  } catch {
    if (session.isClosed) return;
    clearPreview(session);
    setNote(session, 'status', POSTER_TEXT.artFailed);
    session.isBusy = false;
    syncControls(session);
    return;
  }
  if (session.isClosed) return;
  const missingImageCount = countMissingImages(cards);
  session.shown = cards;
  session.isReady = true;
  session.isBusy = false;
  setNote(session, 'status', missingImageCount > 0 ? POSTER_TEXT.imagesFailed(missingImageCount) : null);
  syncControls(session);
  scheduleRender(session);
}

function goToPage(session: PosterSession, index: number): void {
  const pageCards = session.pages[index];
  if (!pageCards || session.isBusy || session.isClosed) return;
  session.pageIndex = index;
  void loadPage(session, pageCards);
}

function requestNickname(session: PosterSession): void {
  if (session.hasNicknameRequest || session.isClosed) return;
  session.hasNicknameRequest = true;
  const finish = (nickname: string | null): void => {
    session.nicknameTask = null;
    if (session.isClosed) return;
    session.nickname = nickname;
    setNote(session, 'nickname', nickname === null ? POSTER_TEXT.nicknameFailed : null);
    scheduleRender(session);
  };
  session.nicknameTask = session.host.fetchNickname(session.profileSlug, session.abort.signal).then(finish, () => finish(null));
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

async function renderCards(session: PosterSession, cards: readonly ShownCard[], settings: ContentSettings): Promise<RenderedPage> {
  const blob = await session.host.render(contentOf(settings, cards, session));
  return { blob, missingImageCount: countMissingImages(cards) };
}

async function renderPage(session: PosterSession, index: number, pageCards: readonly SelectedCard[], settings: ContentSettings): Promise<RenderedPage> {
  if (index === session.pageIndex) return renderCards(session, session.shown, settings);
  const cards = await loadCards(session, pageCards);
  try {
    return await renderCards(session, cards, settings);
  } finally {
    closeImages(cards);
  }
}

async function renderEveryPage(session: PosterSession, settings: ContentSettings): Promise<RenderedPages> {
  const entries: ArchiveEntry[] = [];
  let missingImageCount = 0;
  for (const [index, pageCards] of session.pages.entries()) {
    if (session.isClosed) break;
    setNote(session, 'archive', POSTER_TEXT.archiving(index + 1, session.pages.length));
    const rendered = await renderPage(session, index, pageCards, settings);
    entries.push({ name: fileNameOf(session.profileSlug, pageRefOf(session, index)), blob: rendered.blob });
    missingImageCount += rendered.missingImageCount;
  }
  return { entries, missingImageCount };
}

const canStartArchive = (session: PosterSession): boolean => !session.isBusy && session.isReady && !session.isClosed;

async function buildArchive(session: PosterSession): Promise<BuiltArchive | null> {
  const settings = settingsOf(session);
  const shouldIncludeNickname = session.controls.nickname.checked;
  if (shouldIncludeNickname && session.nicknameTask) {
    await session.nicknameTask;
    settings.nickname = session.nickname;
  }
  const rendered = await renderEveryPage(session, settings);
  if (session.isClosed) return null;
  const archive = await session.host.pack(rendered.entries);
  return session.isClosed ? null : { archive, missingImageCount: rendered.missingImageCount };
}

async function pressDownloadAll(session: PosterSession): Promise<void> {
  if (!canStartArchive(session)) return;
  session.isBusy = true;
  syncControls(session);
  try {
    const built = await buildArchive(session);
    if (built) {
      setNote(session, 'archive', built.missingImageCount > 0 ? POSTER_TEXT.imagesFailed(built.missingImageCount) : null);
      session.host.download(built.archive, archiveNameOf(session.profileSlug));
    }
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
    nicknameTask: null,
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
  const [firstPageCards] = pages;
  if (!firstPageCards) {
    setNote(session, 'status', POSTER_TEXT.nothingToDraw);
    return;
  }
  if (session.controls.nickname.checked) requestNickname(session);
  void loadPage(session, firstPageCards);
}
