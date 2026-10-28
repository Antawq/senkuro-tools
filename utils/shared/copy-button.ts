import { BADGE_INSET, CENTER, CENTERING_SHIFT, centerGapShift, gapKey, insetAbove, insetBelow, NO_GAP, type FaceGap } from './badge-layout';
import type { BadgePositionX, BadgePositionY } from './settings';
import { copyIcon, doneIcon } from './svg';

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

const clearOfBadge = (badgeY: BadgePositionY): BadgePositionY => (badgeY === 'top' ? 'bottom' : 'top');

function place(button: HTMLElement, positionX: BadgePositionX, badgeY: BadgePositionY, gap: FaceGap): void {
  const positionY = positionX === 'center' ? clearOfBadge(badgeY) : badgeY;
  const right = positionX === 'right';
  const bottom = positionY === 'bottom';

  button.style.setProperty('translate', `${positionX === 'center' ? CENTERING_SHIFT : '0'} ${positionY === 'center' ? CENTERING_SHIFT : '0'}`);

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
    const created = document.createElement('button');
    created.type = 'button';
    created.className = BUTTON;
    button = created;
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
