import { element, writeAttribute } from '../shared/dom';
import { chevronIcon } from '../shared/svg';

const ARROW_BUTTON = 'button button--secondary button--icon button-size--md';

export interface PagerLabels {
  previous: string;
  next: string;
}

export interface PagerState {
  positionText: string;
  hasPrevious: boolean;
  hasNext: boolean;
}

export interface PagerControls {
  root: HTMLElement;
  previous: HTMLButtonElement;
  next: HTMLButtonElement;
  positionLabel: HTMLElement;
}

function createArrow(blockClass: string, name: 'previous' | 'next', label: string): HTMLButtonElement {
  const button = element('button', `${ARROW_BUTTON} ${blockClass}__${name}`);
  button.type = 'button';
  button.setAttribute('aria-label', label);
  const icon = chevronIcon(`${blockClass}__arrow ${blockClass}__arrow--${name}`);
  icon.setAttribute('aria-hidden', 'true');
  button.append(icon);
  return button;
}

export function createPager(blockClass: string, labels: PagerLabels): PagerControls {
  const previous = createArrow(blockClass, 'previous', labels.previous);
  const next = createArrow(blockClass, 'next', labels.next);
  const positionLabel = element('span', `${blockClass}__position`);
  positionLabel.setAttribute('aria-live', 'polite');
  const root = element('div', `${blockClass}__pager`);
  root.append(previous, positionLabel, next);
  return { root, previous, next, positionLabel };
}

export function syncPager(pager: PagerControls, state: PagerState): void {
  if (pager.positionLabel.textContent !== state.positionText) pager.positionLabel.textContent = state.positionText;
  writeAttribute(pager.previous, 'aria-disabled', state.hasPrevious ? null : 'true');
  writeAttribute(pager.next, 'aria-disabled', state.hasNext ? null : 'true');
}
