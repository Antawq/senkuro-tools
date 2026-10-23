const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';

export type Shape = [string, Record<string, string>];

const OUTLINE: Readonly<Record<string, string>> = { fill: 'none', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' };

export function svgIcon(attributes: Record<string, string>, shapes: Shape[]): SVGSVGElement {
  const svg = document.createElementNS(SVG_NAMESPACE, 'svg');
  Object.entries({ ...OUTLINE, ...attributes }).forEach(([key, value]) => svg.setAttribute(key, value));
  for (const [tag, shape] of shapes) {
    const node = document.createElementNS(SVG_NAMESPACE, tag);
    Object.entries(shape).forEach(([key, value]) => node.setAttribute(key, value));
    svg.append(node);
  }
  return svg;
}

export const refreshIcon = (size: number): SVGSVGElement =>
  svgIcon({ viewBox: '0 0 16 16', width: String(size), height: String(size), stroke: 'currentColor', 'stroke-width': '1.7' }, [
    ['path', { d: 'M2.5 8a5.5 5.5 0 0 1 9.4-3.9L13.5 6M13.5 2.5V6h-3.5M13.5 8a5.5 5.5 0 0 1-9.4 3.9L2.5 10M2.5 13.5V10H6' }],
  ]);

export const chevronIcon = (className?: string): SVGSVGElement =>
  svgIcon({ ...(className ? { class: className } : {}), viewBox: '0 0 10 6', width: '9', height: '6', stroke: 'currentColor', 'stroke-width': '1.8' }, [
    ['path', { d: 'm1 1 4 4 4-4' }],
  ]);
