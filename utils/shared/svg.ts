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

export const refreshIcon = (sizePx: number): SVGSVGElement =>
  svgIcon({ viewBox: '0 -960 960 960', width: String(sizePx), height: String(sizePx), fill: 'currentColor' }, [
    [
      'path',
      {
        d: 'M480-160q-133 0-226.5-93.5T160-480q0-133 93.5-226.5T480-800q85 0 149 34.5T740-671v-99q0-13 8.5-21.5T770-800q13 0 21.5 8.5T800-770v194q0 13-8.5 21.5T770-546H576q-13 0-21.5-8.5T546-576q0-13 8.5-21.5T576-606h138q-38-60-97-97t-137-37q-109 0-184.5 75.5T220-480q0 109 75.5 184.5T480-220q75 0 140-39.5T717-366q5-11 16.5-16.5t22.5-.5q12 5 16 16.5t-1 23.5q-39 84-117.5 133.5T480-160Z',
      },
    ],
  ]);

export const chevronIcon = (className?: string): SVGSVGElement =>
  svgIcon({ ...(className ? { class: className } : {}), viewBox: '0 0 10 6', width: '9', height: '6', stroke: 'currentColor', 'stroke-width': '1.8' }, [
    ['path', { d: 'm1 1 4 4 4-4' }],
  ]);

export const lockIcon = (sizePx: number): SVGSVGElement =>
  svgIcon({ viewBox: '0 -960 960 960', width: String(sizePx), height: String(sizePx), fill: 'currentColor' }, [
    [
      'path',
      {
        d: 'M240-80q-33 0-56.5-23.5T160-160v-400q0-33 23.5-56.5T240-640h40v-80q0-83 58.5-141.5T480-920q83 0 141.5 58.5T680-720v80h40q33 0 56.5 23.5T800-560v400q0 33-23.5 56.5T720-80H240Zm0-80h480v-400H240v400Zm240-120q33 0 56.5-23.5T560-360q0-33-23.5-56.5T480-440q-33 0-56.5 23.5T400-360q0 33 23.5 56.5T480-280ZM360-640h240v-80q0-50-35-85t-85-35q-50 0-85 35t-35 85v80Z',
      },
    ],
  ]);

export const lockOpenIcon = (sizePx: number): SVGSVGElement =>
  svgIcon({ viewBox: '0 -960 960 960', width: String(sizePx), height: String(sizePx), fill: 'currentColor' }, [
    [
      'path',
      {
        d: 'M240-80q-33 0-56.5-23.5T160-160v-400q0-33 23.5-56.5T240-640h280v-80q0-83-58.5-141.5T320-920q-17 0-28.5-11.5T280-960q0-17 11.5-28.5T320-1000q116 0 198 82t82 198v80h120q33 0 56.5 23.5T800-560v400q0 33-23.5 56.5T720-80H240Zm0-80h480v-400H240v400Zm240-120q33 0 56.5-23.5T560-360q0-33-23.5-56.5T480-440q-33 0-56.5 23.5T400-360q0 33 23.5 56.5T480-280Z',
      },
    ],
  ]);

export const searchIcon = (sizePx: number): SVGSVGElement =>
  svgIcon({ viewBox: '0 -960 960 960', width: String(sizePx), height: String(sizePx), fill: 'currentColor' }, [
    [
      'path',
      {
        d: 'M784-120 532-372q-30 24-69 38t-83 14q-109 0-184.5-75.5T120-580q0-109 75.5-184.5T380-840q109 0 184.5 75.5T640-580q0 44-14 83t-38 69l252 252-56 56ZM380-400q75 0 127.5-52.5T560-580q0-75-52.5-127.5T380-760q-75 0-127.5 52.5T200-580q0 75 52.5 127.5T380-400Z',
      },
    ],
  ]);

export const closeIcon = (sizePx: number): SVGSVGElement =>
  svgIcon({ viewBox: '0 -960 960 960', width: String(sizePx), height: String(sizePx), fill: 'currentColor' }, [
    [
      'path',
      {
        d: 'M480-424 284-228q-11 11-28 11t-28-11q-11-11-11-28t11-28l196-196-196-196q-11-11-11-28t11-28q11-11 28-11t28 11l196 196 196-196q11-11 28-11t28 11q11 11 11 28t-11 28L536-480l196 196q11 11 11 28t-11 28q-11 11-28 11t-28-11L480-424Z',
      },
    ],
  ]);
