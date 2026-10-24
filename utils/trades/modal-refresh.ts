import { element } from '../shared/dom';
import type { RefreshOutcome } from '../shared/refresh-signal';
import { refreshIcon } from '../shared/svg';

export const MODAL_REFRESH_CLASS = 'senkutools-modal-refresh';

const MODAL = '.modal-content--trade';
const HEADER = '.modal-trade__header';
const LIST = '.modal-trade__body-result';
const CATALOG_STEP = 'из общего каталога';
const SITE_BUTTON = 'button button--secondary button--icon button-size--md';
const ICON_SIZE_PX = 20;
const LABEL = 'Обновить список карт';

export interface ModalRefreshHost {
  isReady: () => boolean;
  refresh: () => Promise<RefreshOutcome>;
  nextFrame: (run: () => void) => void;
}

const findCloseButton = (header: Element): HTMLElement | null =>
  [...header.children].find(
    (child): child is HTMLElement => child instanceof HTMLElement && child.tagName === 'BUTTON' && !child.classList.contains(MODAL_REFRESH_CLASS)
  ) ?? null;

const findOwnButton = (header: Element): HTMLButtonElement | null => header.querySelector<HTMLButtonElement>(`:scope > .${MODAL_REFRESH_CLASS}`);

const listsUserCards = (modal: Element, header: Element): boolean => modal.querySelector(LIST) !== null && !(header.textContent ?? '').includes(CATALOG_STEP);

function createModalRefreshButton(host: ModalRefreshHost): HTMLButtonElement {
  const button = element('button', `${SITE_BUTTON} ${MODAL_REFRESH_CLASS}`);
  button.type = 'button';
  button.title = LABEL;
  button.setAttribute('aria-label', LABEL);
  const icon = refreshIcon(ICON_SIZE_PX);
  icon.setAttribute('aria-hidden', 'true');
  button.append(icon);
  button.addEventListener('click', () => {
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    void host.refresh().then(() => {
      button.disabled = false;
      button.removeAttribute('aria-busy');
    });
  });
  return button;
}

function syncModal(modal: Element, host: ModalRefreshHost): void {
  const header = modal.querySelector(HEADER);
  if (!header) return;
  const own = findOwnButton(header);
  const closeButton = findCloseButton(header);
  if (!closeButton || !host.isReady() || !listsUserCards(modal, header)) {
    own?.remove();
    return;
  }
  if (own?.nextElementSibling === closeButton) return;
  closeButton.before(own ?? createModalRefreshButton(host));
}

export function syncModalRefreshButtons(host: ModalRefreshHost, pageDocument: Document = document): void {
  for (const modal of pageDocument.querySelectorAll(MODAL)) syncModal(modal, host);
}

const isOwnNode = (node: Node): boolean => node instanceof Element && node.classList.contains(MODAL_REFRESH_CLASS);

const holdsModal = (node: Node): boolean => node instanceof Element && (node.matches(MODAL) || node.querySelector(MODAL) !== null);

export const isModalMutation = (mutation: MutationRecord): boolean => {
  const changed = [...mutation.addedNodes, ...mutation.removedNodes];
  if (changed.length > 0 && changed.every(isOwnNode)) return false;
  const target = mutation.target instanceof Element ? mutation.target : mutation.target.parentElement;
  if (target?.closest(`.${MODAL_REFRESH_CLASS}`)) return false;
  return Boolean(target?.closest(MODAL)) || [...mutation.addedNodes].some(holdsModal);
};

export function createModalRefreshWatcher(host: ModalRefreshHost) {
  let isScheduled = false;
  return {
    watch(mutations: Iterable<MutationRecord>) {
      if (isScheduled || ![...mutations].some(isModalMutation)) return;
      isScheduled = true;
      host.nextFrame(() => {
        isScheduled = false;
        syncModalRefreshButtons(host);
      });
    },
  };
}
