import { PRICE_DECIMALS, effectivePrice } from '../shared/cards';
import type { Database } from '../shared/database';
import { element } from '../shared/dom';
import type { Settings } from '../shared/settings';
import { closeIcon } from '../shared/svg';
import { UNKNOWN_MARK } from '../shared/trade-value';
import type { PosterArt } from './poster-art';
import type { SelectedCard } from './poster-cards';
import { POSTER_MAX_CARDS } from './poster-layout';
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
  copy: 'Копировать',
  close: 'Закрыть',
  loading: 'Загружаю карты',
  copied: 'Скопировано',
  copyFailed: 'Не удалось скопировать',
  artFailed: 'Не удалось получить картинки карт',
  renderFailed: 'Не удалось собрать картинку',
  nicknameFailed: 'Не удалось получить ник',
  nothingToDraw: 'Нет карт для постера',
  imagesFailed: (count: number): string => `Не загрузились картинки: ${count}`,
  leftOut: (count: number): string => `Не поместились: ${count}`,
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
  nextFrame: (run: () => void) => void;
  download: (blob: Blob, fileName: string) => void;
  copyImage: (blob: Blob) => Promise<void>;
}

type NoteKind = 'leftOut' | 'status' | 'nickname' | 'render' | 'copy';

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
  close: HTMLButtonElement;
}

interface ShownCard extends SelectedCard {
  image: ImageBitmap | null;
}

interface PosterSession {
  host: PosterDialogHost;
  controls: DialogControls;
  profileSlug: string;
  shown: readonly ShownCard[];
  notes: Map<NoteKind, string>;
  abort: AbortController;
  nickname: string | null;
  blob: Blob | null;
  imageUrl: string | null;
  latestRender: symbol | null;
  hasNicknameRequest: boolean;
  isReady: boolean;
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

function createControls(): DialogControls {
  const dialog = element('dialog', DIALOG_CLASS);
  dialog.setAttribute('aria-label', POSTER_TEXT.title);
  const image = element('img', `${DIALOG_CLASS}__image`);
  image.alt = POSTER_TEXT.imageAlt;
  const preview = element('div', `${DIALOG_CLASS}__preview`);
  preview.append(image);
  const heading = createHeadingField();
  const nickname = createToggle('nickname', POSTER_TEXT.nickname, true);
  const quantity = createToggle('quantity', POSTER_TEXT.quantity, true);
  const prices = createToggle('prices', POSTER_TEXT.prices, false);
  const note = element('p', `${DIALOG_CLASS}__note`);
  note.setAttribute('role', 'status');
  const download = createButton(DOWNLOAD_BUTTON, 'download', POSTER_TEXT.download);
  const copy = createButton(COPY_BUTTON, 'copy', POSTER_TEXT.copy);
  const actions = element('div', `${DIALOG_CLASS}__actions`);
  actions.append(download, copy);
  const form = element('form', `${DIALOG_CLASS}__controls`);
  form.addEventListener('submit', (event) => event.preventDefault());
  form.append(heading.label, nickname.label, quantity.label, prices.label, note, actions);
  const body = element('div', `${DIALOG_CLASS}__body`);
  body.append(preview, form);
  const close = createCloseButton();
  dialog.append(body, close);
  return { dialog, image, heading: heading.input, nickname: nickname.input, quantity: quantity.input, prices: prices.input, note, download, copy, close };
}

function setNote(session: PosterSession, kind: NoteKind, text: string | null): void {
  if (text === null) session.notes.delete(kind);
  else session.notes.set(kind, text);
  session.controls.note.textContent = [...session.notes.values()].join(NOTE_SEPARATOR);
}

function setButtonsEnabled(controls: DialogControls, isEnabled: boolean): void {
  for (const button of [controls.download, controls.copy]) {
    if (isEnabled) button.removeAttribute('aria-disabled');
    else button.setAttribute('aria-disabled', 'true');
  }
}

export const fileNameOf = (profileSlug: string): string => {
  const safeSlug = profileSlug.replace(FILE_NAME_UNSAFE, '-').replace(FILE_NAME_EDGES, '');
  return `senkutools-poster-${safeSlug || FILE_NAME_FALLBACK}.png`;
};

function priceTextOf(slug: string, host: PosterDialogHost): string {
  const entry = host.database[slug];
  return entry ? effectivePrice(entry.price, host.settings.commission).toFixed(PRICE_DECIMALS) : UNKNOWN_MARK;
}

function contentOf(session: PosterSession): PosterContent {
  const { controls, host } = session;
  return {
    cards: session.shown.map((card) => ({
      selected: { slug: card.slug, quantity: card.quantity },
      image: card.image,
      priceText: controls.prices.checked ? priceTextOf(card.slug, host) : null,
    })),
    heading: controls.heading.value,
    nickname: controls.nickname.checked ? session.nickname : null,
    shouldShowQuantity: controls.quantity.checked,
  };
}

function showBlob(session: PosterSession, blob: Blob): void {
  if (session.imageUrl) URL.revokeObjectURL(session.imageUrl);
  session.imageUrl = URL.createObjectURL(blob);
  session.blob = blob;
  session.controls.image.src = session.imageUrl;
  setButtonsEnabled(session.controls, true);
}

async function runRender(session: PosterSession): Promise<void> {
  const render = Symbol('render');
  session.latestRender = render;
  const isStale = (): boolean => session.isClosed || session.latestRender !== render;
  setNote(session, 'copy', null);
  try {
    const blob = await session.host.render(contentOf(session));
    if (isStale()) return;
    setNote(session, 'render', null);
    showBlob(session, blob);
  } catch {
    if (isStale()) return;
    session.blob = null;
    setButtonsEnabled(session.controls, false);
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

async function loadImages(session: PosterSession, arts: Map<string, PosterArt>): Promise<number> {
  await Promise.all(
    session.shown.map(async (card) => {
      const art = arts.get(card.slug);
      card.image = art ? await session.host.loadImage(art).catch(() => null) : null;
    })
  );
  return session.shown.filter((card) => card.image === null).length;
}

async function loadSession(session: PosterSession): Promise<void> {
  setNote(session, 'status', POSTER_TEXT.loading);
  let failedCount: number;
  try {
    const arts = await session.host.fetchArt(
      session.shown.map((card) => card.slug),
      session.abort.signal
    );
    failedCount = await loadImages(session, arts);
  } catch {
    if (!session.isClosed) setNote(session, 'status', POSTER_TEXT.artFailed);
    return;
  }
  if (session.isClosed) return;
  session.isReady = true;
  setNote(session, 'status', failedCount > 0 ? POSTER_TEXT.imagesFailed(failedCount) : null);
  scheduleRender(session);
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
  if (session.blob) session.host.download(session.blob, fileNameOf(session.profileSlug));
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

function teardown(session: PosterSession): void {
  session.isClosed = true;
  session.abort.abort();
  if (session.imageUrl) URL.revokeObjectURL(session.imageUrl);
  for (const card of session.shown) card.image?.close();
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
  controls.close.addEventListener('click', () => controls.dialog.close());
  controls.dialog.addEventListener('close', () => teardown(session));
}

function createSession(shown: readonly SelectedCard[], profileSlug: string, host: PosterDialogHost): PosterSession {
  return {
    host,
    controls: createControls(),
    profileSlug,
    shown: shown.map((card) => ({ ...card, image: null })),
    notes: new Map(),
    abort: new AbortController(),
    nickname: null,
    blob: null,
    imageUrl: null,
    latestRender: null,
    hasNicknameRequest: false,
    isReady: false,
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
  const session = createSession(cards.slice(0, POSTER_MAX_CARDS), profileSlug, host);
  setButtonsEnabled(session.controls, false);
  bindControls(session);
  session.controls.dialog.dataset.senkutoolsPath = host.pageDocument.location.pathname;
  host.pageDocument.body.append(session.controls.dialog);
  session.controls.dialog.showModal();
  if (cards.length > session.shown.length) setNote(session, 'leftOut', POSTER_TEXT.leftOut(cards.length - session.shown.length));
  if (session.shown.length === 0) {
    setNote(session, 'status', POSTER_TEXT.nothingToDraw);
    return;
  }
  if (session.controls.nickname.checked) requestNickname(session);
  void loadSession(session);
}
