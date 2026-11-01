import { MODAL_FILTER_NODES } from '../shared/modal-filter-nodes';
import { PRICE_FILTER_NODES } from '../shared/price-filter-nodes';
import { createRefreshButton } from '../shared/refresh-button';
import type { RefreshOutcome } from '../shared/refresh-signal';
import { MODAL, TOOLBAR, isUserCardsStep } from '../shared/trade-modal';
import { createFrameWatcher, createMutationFilter } from './mutation-watcher';

export const MODAL_REFRESH_CLASS = 'senkutools-modal-refresh';

export interface ModalRefreshHost {
  isReady: () => boolean;
  refresh: () => Promise<RefreshOutcome>;
  nextFrame: (run: () => void) => void;
}

const findOwnButton = (toolbar: Element): HTMLButtonElement | null => toolbar.querySelector<HTMLButtonElement>(`:scope > .${MODAL_REFRESH_CLASS}`);

const createModalRefreshButton = (host: ModalRefreshHost): HTMLButtonElement =>
  createRefreshButton(async () => {
    await host.refresh();
    return true;
  }, MODAL_REFRESH_CLASS);

function syncModal(modal: Element, host: ModalRefreshHost): void {
  const toolbar = modal.querySelector(TOOLBAR);
  if (!toolbar) return;
  const ownButton = findOwnButton(toolbar);
  if (!host.isReady() || !isUserCardsStep(modal)) {
    ownButton?.remove();
    return;
  }
  if (ownButton && toolbar.lastElementChild === ownButton) return;
  toolbar.append(ownButton ?? createModalRefreshButton(host));
}

export function syncModalRefreshButtons(host: ModalRefreshHost, pageDocument: Document = document): void {
  for (const modal of pageDocument.querySelectorAll(MODAL)) syncModal(modal, host);
}

export const isModalMutation = createMutationFilter(MODAL, `.${MODAL_REFRESH_CLASS}, ${PRICE_FILTER_NODES}, ${MODAL_FILTER_NODES}`);

export const createModalRefreshWatcher = (host: ModalRefreshHost) => createFrameWatcher(isModalMutation, () => syncModalRefreshButtons(host), host.nextFrame);
