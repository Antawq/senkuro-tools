export const BADGE_INSET = '5px';
export const CENTER = '50%';
export const CENTER_SHIFT_X = '-15px';
const CENTER_SHIFT_Y = '-12px';

export interface FaceGap {
  top: number;
  bottom: number;
}

export const NO_GAP: FaceGap = { top: 0, bottom: 0 };

const FACE = ':scope > .card-collect-preview__flip-container';

export function faceGap(root: HTMLElement): FaceGap {
  const face = root.querySelector<HTMLElement>(FACE);
  if (!face || face.offsetParent !== root) return NO_GAP;
  return { top: Math.max(0, face.offsetTop), bottom: Math.max(0, root.offsetHeight - face.offsetTop - face.offsetHeight) };
}

const shifted = (base: string, gap: number): string => (gap ? `calc(${base} + ${gap}px)` : base);

export const insetAbove = (gap: FaceGap): string => shifted(BADGE_INSET, gap.top);

export const insetBelow = (gap: FaceGap): string => shifted(BADGE_INSET, gap.bottom);

export const centerShiftY = (gap: FaceGap): string => shifted(CENTER_SHIFT_Y, (gap.top - gap.bottom) / 2);

export const gapKey = (gap: FaceGap): string => (gap.top || gap.bottom ? `:${gap.top}:${gap.bottom}` : '');
