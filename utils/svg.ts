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
