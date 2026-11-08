import { SITE_ICON_BUTTON, element, writeAttribute } from '../shared/dom';
import { closeIcon, doneIcon } from '../shared/svg';
import { createPager, syncPager, type PagerControls } from './poster-pager';

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
  position: (pageNumber: number, pageCount: number): string => `Страница ${pageNumber} из ${pageCount}`,
  archiving: (pageNumber: number, pageCount: number): string => `Собираю архив: ${pageNumber} из ${pageCount}`,
} as const;

export const DIALOG_CLASS = 'senkutools-poster';

const DOWNLOAD_BUTTON = 'button button--accent button--fluid button-size--lg';
const COPY_BUTTON = 'button button--secondary button--fluid button-size--lg';
const CLOSE_ICON_SIZE_PX = 20;
const CHECK_ICON_SIZE_PX = 16;
const HEADING_MAX_LENGTH = 60;
const FILE_NAME_UNSAFE = /[^a-z0-9_-]+/gi;
const FILE_NAME_EDGES = /^-+|-+$/g;
const FILE_NAME_FALLBACK = 'poster';

export interface PageRef {
  number: number;
  count: number;
}

export interface DialogControls {
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

export interface ControlsState {
  hasBlob: boolean;
  isReady: boolean;
  isBusy: boolean;
  pageIndex: number;
  pageCount: number;
}

function syncToggle(label: HTMLElement, box: HTMLElement, input: HTMLInputElement): void {
  label.classList.toggle('checkbox--active', input.checked);
  box.setAttribute('aria-checked', String(input.checked));
}

function createToggleBox(caption: string): HTMLSpanElement {
  const icon = element('span', 'checkbox__el-icon');
  const check = doneIcon(CHECK_ICON_SIZE_PX);
  check.setAttribute('aria-hidden', 'true');
  icon.append(check);
  const mark = element('span', 'checkbox__el');
  mark.append(icon);
  const box = element('span', 'checkbox__wrap');
  box.tabIndex = 0;
  box.setAttribute('role', 'checkbox');
  box.setAttribute('aria-label', caption);
  box.append(mark);
  return box;
}

function createToggle(name: string, caption: string, isChecked: boolean): { label: HTMLLabelElement; input: HTMLInputElement } {
  const input = element('input', `${DIALOG_CLASS}__${name}`);
  input.type = 'checkbox';
  input.checked = isChecked;
  const box = createToggleBox(caption);
  const label = element('label', `checkbox checkbox-size--md ${DIALOG_CLASS}__toggle`);
  label.append(input, box, element('span', 'checkbox__label', caption));
  syncToggle(label, box, input);
  input.addEventListener('change', () => syncToggle(label, box, input));
  box.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    input.click();
  });
  return { label, input };
}

function createHeadingField(): { label: HTMLLabelElement; input: HTMLInputElement } {
  const input = element('input', `input-el ${DIALOG_CLASS}__heading`);
  input.type = 'text';
  input.maxLength = HEADING_MAX_LENGTH;
  input.autocomplete = 'off';
  input.placeholder = POSTER_TEXT.headingPlaceholder;
  const wrap = element('div', 'input-wrap');
  wrap.append(input);
  const label = element('label', `input input-size--md ${DIALOG_CLASS}__field`);
  label.append(element('span', 'input-label', POSTER_TEXT.heading), wrap);
  return { label, input };
}

function createButton(className: string, name: string, text?: string): HTMLButtonElement {
  const button = element('button', `${className} ${DIALOG_CLASS}__${name}`, text);
  button.type = 'button';
  return button;
}

function createCloseButton(): HTMLButtonElement {
  const button = createButton(SITE_ICON_BUTTON, 'close');
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

export function createControls(pageCount: number): DialogControls {
  const dialog = element('dialog', DIALOG_CLASS);
  dialog.setAttribute('aria-label', POSTER_TEXT.title);
  const image = element('img', `${DIALOG_CLASS}__image`);
  image.alt = POSTER_TEXT.imageAlt;
  const isPaged = pageCount > 1;
  const pager = isPaged ? createPager(DIALOG_CLASS, { previous: POSTER_TEXT.previousPage, next: POSTER_TEXT.nextPage }) : null;
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

export function syncDialogControls(controls: DialogControls, state: ControlsState): void {
  const { hasBlob, isReady, isBusy, pageIndex, pageCount } = state;
  for (const button of [controls.download, controls.copy]) writeAttribute(button, 'aria-disabled', hasBlob ? null : 'true');
  if (controls.downloadAll) writeAttribute(controls.downloadAll, 'aria-disabled', isBusy || !isReady ? 'true' : null);
  if (controls.pager) {
    syncPager(controls.pager, {
      positionText: POSTER_TEXT.position(pageIndex + 1, pageCount),
      hasPrevious: !isBusy && pageIndex > 0,
      hasNext: !isBusy && pageIndex < pageCount - 1,
    });
  }
}

const baseNameOf = (profileSlug: string): string => {
  const safeSlug = profileSlug.replace(FILE_NAME_UNSAFE, '-').replace(FILE_NAME_EDGES, '');
  return `senkutools-poster-${safeSlug || FILE_NAME_FALLBACK}`;
};

const pageSuffixOf = (pageRef: PageRef | undefined): string => (pageRef ? `-${String(pageRef.number).padStart(String(pageRef.count).length, '0')}` : '');

export const fileNameOf = (profileSlug: string, pageRef?: PageRef): string => `${baseNameOf(profileSlug)}${pageSuffixOf(pageRef)}.png`;

export const archiveNameOf = (profileSlug: string): string => `${baseNameOf(profileSlug)}.zip`;
