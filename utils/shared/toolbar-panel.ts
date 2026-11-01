import { element } from './dom';

export const TOOLBAR_PANEL_CLASS = 'senkutools-toolbar-panel';
export const VIEWPORT_MARGIN_PX = 16;

const SITE_DROPDOWN = 'v-popper--theme-dropdown';

export function createPanelShell(className: string, menu: HTMLElement): HTMLElement {
  const panel = element('div', `${className} ${TOOLBAR_PANEL_CLASS} ${SITE_DROPDOWN}`);
  panel.hidden = true;
  const inner = element('div', 'v-popper__inner');
  inner.append(menu);
  const wrapper = element('div', 'v-popper__wrapper');
  wrapper.append(inner);
  panel.append(wrapper);
  return panel;
}

function placePanel(panel: HTMLElement): void {
  panel.style.removeProperty('left');
  const viewportWidth = panel.ownerDocument.documentElement.clientWidth;
  const box = panel.getBoundingClientRect();
  const overflow = box.right - (viewportWidth - VIEWPORT_MARGIN_PX);
  if (overflow > 0) panel.style.left = `${-Math.min(overflow, Math.max(0, box.left - VIEWPORT_MARGIN_PX))}px`;
}

export function setPanelOpen(panel: HTMLElement, trigger: Element, isOpen: boolean): void {
  panel.hidden = !isOpen;
  trigger.setAttribute('aria-expanded', String(isOpen));
  if (isOpen) placePanel(panel);
}

export function closeToolbarPanels(pageDocument: Document, target: EventTarget | null): void {
  for (const panel of pageDocument.querySelectorAll<HTMLElement>(`.${TOOLBAR_PANEL_CLASS}:not([hidden])`)) {
    const host = panel.parentElement;
    const trigger = host?.querySelector(':scope > [aria-expanded]');
    if (host && trigger && !(target instanceof Node && host.contains(target))) setPanelOpen(panel, trigger, false);
  }
}
