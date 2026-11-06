import { element, writeAttribute } from '../shared/dom';
import { chevronIcon } from '../shared/svg';

const ARROW_BUTTON = 'button button--secondary button--icon button-size--md';

export interface PagerLabels {
  previous: string;
  next: string;
}

export interface PagerState {
  position: string;
  hasPrevious: boolean;
  hasNext: boolean;
}

export interface PagerControls {
  root: HTMLElement;
  previous: HTMLButtonElement;
  next: HTMLButtonElement;
  position: HTMLElement;
}

function createArrow(name: 'previous' | 'next', label: string): HTMLButtonElement {
  const button = element('button', `${ARROW_BUTTON} senkutools-poster__${name}`);
  button.type = 'button';
  button.setAttribute('aria-label', label);
  const icon = chevronIcon(`senkutools-poster__arrow senkutools-poster__arrow--${name}`);
  icon.setAttribute('aria-hidden', 'true');
  button.append(icon);
  return button;
}

export function createPager(labels: PagerLabels): PagerControls {
  const previous = createArrow('previous', labels.previous);
  const next = createArrow('next', labels.next);
  const position = element('span', 'senkutools-poster__position');
  position.setAttribute('aria-live', 'polite');
  const root = element('div', 'senkutools-poster__pager');
  root.append(previous, position, next);
  return { root, previous, next, position };
}

export function syncPager(pager: PagerControls, state: PagerState): void {
  pager.position.textContent = state.position;
  writeAttribute(pager.previous, 'aria-disabled', state.hasPrevious ? null : 'true');
  writeAttribute(pager.next, 'aria-disabled', state.hasNext ? null : 'true');
}
