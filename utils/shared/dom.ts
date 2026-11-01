export function writeAttribute(target: Element, name: string, attributeValue: string | null): void {
  if (attributeValue === null) target.removeAttribute(name);
  else if (target.getAttribute(name) !== attributeValue) target.setAttribute(name, attributeValue);
}

export const childWithClass = (parent: Element, className: string): HTMLElement | undefined =>
  [...parent.children].find((child): child is HTMLElement => child instanceof HTMLElement && child.classList.contains(className));

export function placeBeforeAny(parent: Element, node: Element, laterSelectors: readonly string[]): void {
  const later = laterSelectors.length === 0 ? null : parent.querySelector(laterSelectors.map((selector) => `:scope > ${selector}`).join(', '));
  if (later ? node.nextElementSibling === later : parent.lastElementChild === node) return;
  parent.insertBefore(node, later);
}

export const element = <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] => {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
};
