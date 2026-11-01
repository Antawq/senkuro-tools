export function writeAttribute(target: Element, name: string, attributeValue: string | null): void {
  if (attributeValue === null) target.removeAttribute(name);
  else if (target.getAttribute(name) !== attributeValue) target.setAttribute(name, attributeValue);
}

export const childWithClass = (parent: Element, className: string): HTMLElement | undefined =>
  [...parent.children].find((child): child is HTMLElement => child instanceof HTMLElement && child.classList.contains(className));

export const element = <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] => {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
};
