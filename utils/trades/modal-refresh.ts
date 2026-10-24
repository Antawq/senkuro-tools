import { createRefreshButton } from '../shared/refresh-button';
import type { RefreshOutcome } from '../shared/refresh-signal';
import { createFrameWatcher, createMutationFilter } from './mutation-watcher';

export const MODAL_REFRESH_CLASS = 'senkutools-modal-refresh';

const MODAL = '.modal-content--trade';
const HEADER = '.modal-trade__header';
const TOOLBAR = '.modal-trade__header-form';
const LIST = '.modal-trade__body-result';
const CATALOG_STEP = 'из общего каталога';

export interface ModalRefreshHost {
  isReady: () => boolean;
  refresh: () => Promise<RefreshOutcome>;
  nextFrame: (run: () => void) => void;
}

const findOwnButton = (toolbar: Element): HTMLButtonElement | null => toolbar.querySelector<HTMLButtonElement>(`:scope > .${MODAL_REFRESH_CLASS}`);

const listsUserCards = (modal: Element): boolean =>
  modal.querySelector(LIST) !== null && !(modal.querySelector(HEADER)?.textContent ?? '').includes(CATALOG_STEP);

const createModalRefreshButton = (host: ModalRefreshHost): HTMLButtonElement =>
  createRefreshButton(async () => {
    await host.refresh();
    return true;
  }, MODAL_REFRESH_CLASS);

function syncModal(modal: Element, host: ModalRefreshHost): void {
  const toolbar = modal.querySelector(TOOLBAR);
  if (!toolbar) return;
  const own = findOwnButton(toolbar);
  if (!host.isReady() || !listsUserCards(modal)) {
    own?.remove();
    return;
  }
  if (own && toolbar.lastElementChild === own) return;
  toolbar.append(own ?? createModalRefreshButton(host));
}

export function syncModalRefreshButtons(host: ModalRefreshHost, pageDocument: Document = document): void {
  for (const modal of pageDocument.querySelectorAll(MODAL)) syncModal(modal, host);
}

export const isModalMutation = createMutationFilter(MODAL, `.${MODAL_REFRESH_CLASS}`);

export const createModalRefreshWatcher = (host: ModalRefreshHost) => createFrameWatcher(isModalMutation, () => syncModalRefreshButtons(host), host.nextFrame);
