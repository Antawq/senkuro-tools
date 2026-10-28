const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';

type Shape = [string, Record<string, string>];

function svgIcon(attributes: Record<string, string>, shapes: Shape[]): SVGSVGElement {
  const svg = document.createElementNS(SVG_NAMESPACE, 'svg');
  Object.entries(attributes).forEach(([key, value]) => svg.setAttribute(key, value));
  for (const [tag, shape] of shapes) {
    const node = document.createElementNS(SVG_NAMESPACE, tag);
    Object.entries(shape).forEach(([key, value]) => node.setAttribute(key, value));
    svg.append(node);
  }
  return svg;
}

const symbolIcon = (path: string, sizePx: number, className?: string): SVGSVGElement =>
  svgIcon({ ...(className ? { class: className } : {}), viewBox: '0 -960 960 960', width: String(sizePx), height: String(sizePx), fill: 'currentColor' }, [
    ['path', { d: path }],
  ]);

export const refreshIcon = (sizePx: number): SVGSVGElement =>
  symbolIcon(
    'M480-160q-133 0-226.5-93.5T160-480q0-133 93.5-226.5T480-800q85 0 149 34.5T740-671v-99q0-13 8.5-21.5T770-800q13 0 21.5 8.5T800-770v194q0 13-8.5 21.5T770-546H576q-13 0-21.5-8.5T546-576q0-13 8.5-21.5T576-606h138q-38-60-97-97t-137-37q-109 0-184.5 75.5T220-480q0 109 75.5 184.5T480-220q75 0 140-39.5T717-366q5-11 16.5-16.5t22.5-.5q12 5 16 16.5t-1 23.5q-39 84-117.5 133.5T480-160Z',
    sizePx
  );

export const copyIcon = (sizePx: number): SVGSVGElement =>
  symbolIcon(
    'M360-240q-33 0-56.5-23.5T280-320v-480q0-33 23.5-56.5T360-880h360q33 0 56.5 23.5T800-800v480q0 33-23.5 56.5T720-240H360ZM200-80q-33 0-56.5-23.5T120-160v-520q0-17 11.5-28.5T160-720q17 0 28.5 11.5T200-680v520h400q17 0 28.5 11.5T640-120q0 17-11.5 28.5T600-80H200Z',
    sizePx
  );

export const doneIcon = (sizePx: number): SVGSVGElement =>
  symbolIcon(
    'm382-354 339-339q12-12 28-12t28 12q12 12 12 28.5T777-636L410-268q-12 12-28 12t-28-12L182-440q-12-12-11.5-28.5T183-497q12-12 28.5-12t28.5 12l142 143Z',
    sizePx
  );

const CHEVRON_SIZE_PX = 16;

export const chevronIcon = (className?: string): SVGSVGElement =>
  symbolIcon(
    'M480-361q-8 0-15-2.5t-13-8.5L268-556q-11-11-11-28t11-28q11-11 28-11t28 11l156 156 156-156q11-11 28-11t28 11q11 11 11 28t-11 28L508-372q-6 6-13 8.5t-15 2.5Z',
    CHEVRON_SIZE_PX,
    className
  );
