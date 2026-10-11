import type { BadgePositionX, BadgePositionY } from './settings';

const SVG = 'http://www.w3.org/2000/svg';
const BUTTON = 'senkuro-copy-btn';
const COPIED_MS = 1500;
const COPIED_COLOR = '#4ade80';
const OFFSET = '5px';
const PADDING_STEP = 3.5;
const MIN_PADDING = 2;

export interface CopyButtonOptions {
  name: string;
  size: number;
  positionX: BadgePositionX;
  positionY: BadgePositionY;
  touch: boolean;
}

function icon(size: number, stroke: string, shapes: [string, Record<string, string>][]): SVGSVGElement {
  const svg = document.createElementNS(SVG, 'svg');
  const attributes = {
    width: String(size),
    height: String(size),
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke,
    'stroke-width': '2',
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
  };
  Object.entries(attributes).forEach(([key, value]) => svg.setAttribute(key, value));
  for (const [tag, shape] of shapes) {
    const node = document.createElementNS(SVG, tag);
    Object.entries(shape).forEach(([key, value]) => node.setAttribute(key, value));
    svg.append(node);
  }
  return svg;
}

const copyIcon = (size: number) =>
  icon(size, 'currentColor', [
    ['rect', { x: '9', y: '9', width: '13', height: '13', rx: '2', ry: '2' }],
    ['path', { d: 'M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1' }],
  ]);

const doneIcon = (size: number) => icon(size, COPIED_COLOR, [['polyline', { points: '20 6 9 17 4 12' }]]);

function place(button: HTMLElement, positionX: BadgePositionX, positionY: BadgePositionY): void {
  const right = positionX === 'right';
  const bottom = positionY === 'bottom';

  if (positionX === 'center') {
    button.style.left = '50%';
    button.style.right = 'auto';
    button.style.transform = 'translateX(-50%)';
  } else {
    button.style.transform = 'none';
    button.style.left = right ? OFFSET : 'auto';
    button.style.right = right ? 'auto' : OFFSET;
  }

  if (positionY === 'center') {
    button.style.top = '50%';
    button.style.bottom = 'auto';
    button.style.marginTop = '-12px';
  } else {
    button.style.marginTop = '0';
    button.style.bottom = bottom ? OFFSET : 'auto';
    button.style.top = bottom ? 'auto' : OFFSET;
  }
}

export const removeCopyButton = (root: ParentNode): void => root.querySelector(`.${BUTTON}`)?.remove();

export function syncCopyButton(target: HTMLElement, { name, size, positionX, positionY, touch }: CopyButtonOptions): void {
  let button = target.querySelector<HTMLElement>(`.${BUTTON}`);
  if (!button) {
    button = document.createElement('div');
    button.className = BUTTON;
    target.append(button);
  }
  const current = button;

  if (current.dataset.btnSize !== String(size)) {
    current.dataset.btnSize = String(size);
    current.style.padding = `${Math.max(MIN_PADDING, Math.round(size / PADDING_STEP))}px`;
    current.replaceChildren(copyIcon(size));
  }

  const posKey = `${positionX}-${positionY}`;
  if (current.dataset.btnPos !== posKey) {
    current.dataset.btnPos = posKey;
    place(current, positionX, positionY);
  }

  if (current.dataset.charName === name) return;
  current.dataset.charName = name;
  current.title = `Копировать имя: ${name}`;
  const copy = (event: Event) => {
    event.preventDefault();
    event.stopPropagation();
    navigator.clipboard.writeText(name).then(
      () => {
        current.replaceChildren(doneIcon(size));
        setTimeout(() => current.replaceChildren(copyIcon(size)), COPIED_MS);
      },
      (error: unknown) => console.warn('SenkuTools: clipboard', error)
    );
  };
  current.onclick = copy;
  current.ontouchend = touch ? copy : null;
}
