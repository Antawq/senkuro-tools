import { describe, expect, it } from 'vitest';

import { createPager, syncPager } from '../utils/poster/poster-pager';

const LABELS = { previous: 'Назад', next: 'Вперёд' };

const stateOf = (positionText: string, hasPrevious = true, hasNext = true): Parameters<typeof syncPager>[1] => ({ positionText, hasPrevious, hasNext });

const disabledOf = (pager: ReturnType<typeof createPager>): (string | null)[] => [
  pager.previous.getAttribute('aria-disabled'),
  pager.next.getAttribute('aria-disabled'),
];

describe('createPager', () => {
  it('builds the previous arrow, the position label and the next arrow in order', () => {
    const pager = createPager('senkutools-poster', LABELS);
    expect(pager.root.className).toBe('senkutools-poster__pager');
    expect([...pager.root.children]).toEqual([pager.previous, pager.positionLabel, pager.next]);
    expect(pager.positionLabel.className).toBe('senkutools-poster__position');
    expect(pager.positionLabel.getAttribute('aria-live')).toBe('polite');
  });

  it('makes each arrow a named site icon button with a hidden rotated chevron', () => {
    const pager = createPager('senkutools-poster', LABELS);
    for (const [name, button, label] of [
      ['previous', pager.previous, LABELS.previous],
      ['next', pager.next, LABELS.next],
    ] as const) {
      expect(button.className).toBe(`button button--secondary button--icon button-size--md senkutools-poster__${name}`);
      expect(button.type).toBe('button');
      expect(button.getAttribute('aria-label')).toBe(label);
      const icon = button.querySelector('svg');
      expect(icon?.getAttribute('class')).toBe(`senkutools-poster__arrow senkutools-poster__arrow--${name}`);
      expect(icon?.getAttribute('aria-hidden')).toBe('true');
    }
  });

  it('prefixes every class with the block class it is given', () => {
    const pager = createPager('shop-dialog', LABELS);
    expect([pager.root.className, pager.positionLabel.className]).toEqual(['shop-dialog__pager', 'shop-dialog__position']);
    expect(pager.previous.className).toContain('shop-dialog__previous');
    expect(pager.next.className).toContain('shop-dialog__next');
  });
});

describe('syncPager', () => {
  it('writes the position and marks only the arrows that cannot move as disabled', () => {
    const pager = createPager('senkutools-poster', LABELS);
    syncPager(pager, stateOf('Страница 1 из 3', false, true));
    expect(pager.positionLabel.textContent).toBe('Страница 1 из 3');
    expect(disabledOf(pager)).toEqual(['true', null]);
    syncPager(pager, stateOf('Страница 3 из 3', true, false));
    expect(disabledOf(pager)).toEqual([null, 'true']);
  });

  it('does not rewrite a position that did not change, so a screen reader hears it once', () => {
    const pager = createPager('senkutools-poster', LABELS);
    const observer = new MutationObserver(() => undefined);
    observer.observe(pager.positionLabel, { childList: true, characterData: true, subtree: true });
    syncPager(pager, stateOf('Страница 1 из 3'));
    expect(observer.takeRecords()).not.toHaveLength(0);
    syncPager(pager, stateOf('Страница 1 из 3', false, true));
    syncPager(pager, stateOf('Страница 1 из 3'));
    expect(observer.takeRecords()).toHaveLength(0);
    syncPager(pager, stateOf('Страница 2 из 3'));
    expect(observer.takeRecords()).not.toHaveLength(0);
    observer.disconnect();
  });
});
