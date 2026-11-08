import { SITE_ICON_BUTTON, element, writeAttribute } from '../shared/dom';
import { chevronIcon } from '../shared/svg';

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
  positionLabel: HTMLElement;
  next: HTMLButtonElement;
}

function createArrowButton(blockClass: string, direction: 'previous' | 'next', label: string): HTMLButtonElement {
  const button = element('button', `${SITE_ICON_BUTTON} ${blockClass}__${direction}`);
  button.type = 'button';
  button.setAttribute('aria-label', label);
  const icon = chevronIcon(`${blockClass}__arrow ${blockClass}__arrow--${direction}`);
  icon.setAttribute('aria-hidden', 'true');
  button.append(icon);
  return button;
}

export function createPager(blockClass: string, labels: PagerLabels): PagerControls {
  const root = element('div', `${blockClass}__pager`);
  const previous = createArrowButton(blockClass, 'previous', labels.previous);
  const positionLabel = element('span', `${blockClass}__position`);
  positionLabel.setAttribute('aria-live', 'polite');
  const next = createArrowButton(blockClass, 'next', labels.next);
  root.append(previous, positionLabel, next);
  return { root, previous, positionLabel, next };
}

export function syncPager(pager: PagerControls, state: PagerState): void {
  if (pager.positionLabel.textContent !== state.positionText) pager.positionLabel.textContent = state.positionText;
  writeAttribute(pager.previous, 'aria-disabled', state.hasPrevious ? null : 'true');
  writeAttribute(pager.next, 'aria-disabled', state.hasNext ? null : 'true');
}
