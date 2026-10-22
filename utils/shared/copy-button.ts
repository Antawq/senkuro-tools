import { BADGE_INSET, CENTER, CENTERED, centerGapShift, gapKey, insetAbove, insetBelow, NO_GAP, type FaceGap } from './badge-layout';
import type { BadgePositionX, BadgePositionY } from './settings';
import { svgIcon, type Shape } from './svg';

const BUTTON = 'senkuro-copy-btn';
const COPIED = `${BUTTON}--done`;
const COPIED_MS = 1500;
const OFFSET = BADGE_INSET;
const PADDING_STEP = 3.5;
const MIN_PADDING = 2;
const INVISIBLE = /\p{Cf}/gu;

export interface CopyButtonOptions {
  name: string;
  size: number;
  positionX: BadgePositionX;
  positionY: BadgePositionY;
  gap?: FaceGap;
  touch: boolean;
}

const icon = (size: number, shapes: Shape[]) =>
  svgIcon({ width: String(size), height: String(size), viewBox: '0 0 24 24', stroke: 'currentColor', 'stroke-width': '2' }, shapes);

const copyIcon = (size: number) =>
  icon(size, [
    ['rect', { x: '9', y: '9', width: '13', height: '13', rx: '2', ry: '2' }],
    ['path', { d: 'M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1' }],
  ]);

const doneIcon = (size: number) => icon(size, [['polyline', { points: '20 6 9 17 4 12' }]]);

const clearOfBadge = (badgeY: BadgePositionY): BadgePositionY => (badgeY === 'top' ? 'bottom' : 'top');

function place(button: HTMLElement, positionX: BadgePositionX, badgeY: BadgePositionY, gap: FaceGap): void {
  const positionY = positionX === 'center' ? clearOfBadge(badgeY) : badgeY;
  const right = positionX === 'right';
  const bottom = positionY === 'bottom';

  button.style.transform = 'none';
  button.style.setProperty('translate', `${positionX === 'center' ? CENTERED : '0'} ${positionY === 'center' ? CENTERED : '0'}`);

  if (positionX === 'center') {
    button.style.left = CENTER;
    button.style.right = 'auto';
  } else {
    button.style.left = right ? OFFSET : 'auto';
    button.style.right = right ? 'auto' : OFFSET;
  }

  if (positionY === 'center') {
    button.style.top = CENTER;
    button.style.bottom = 'auto';
    button.style.marginTop = centerGapShift(gap);
  } else {
    button.style.marginTop = '0';
    button.style.bottom = bottom ? insetBelow(gap) : 'auto';
    button.style.top = bottom ? 'auto' : insetAbove(gap);
  }
}

export const removeCopyButton = (root: ParentNode): void => root.querySelector(`.${BUTTON}`)?.remove();

export const visibleName = (name: string): string => name.replace(INVISIBLE, '').trim();

export function syncCopyButton(target: HTMLElement, { name: rawName, size, positionX, positionY, gap = NO_GAP, touch }: CopyButtonOptions): void {
  const name = visibleName(rawName);
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

  const posKey = `${positionX}-${positionY}${gapKey(gap)}`;
  if (current.dataset.btnPos !== posKey) {
    current.dataset.btnPos = posKey;
    place(current, positionX, positionY, gap);
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
        current.classList.add(COPIED);
        setTimeout(() => {
          current.replaceChildren(copyIcon(size));
          current.classList.remove(COPIED);
        }, COPIED_MS);
      },
      (error: unknown) => console.warn('SenkuTools: clipboard', error)
    );
  };
  current.onclick = copy;
  current.ontouchend = touch ? copy : null;
}
