import { describe, expect, it } from 'vitest';

import { createRefreshButton } from '../utils/shared/refresh-button';

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('createRefreshButton', () => {
  it('is a medium icon button of the site with a hidden icon and no text', () => {
    const button = createRefreshButton(() => Promise.resolve(true));
    expect(button.className).toBe('button button--secondary button--icon button-size--md');
    expect(button.type).toBe('button');
    expect(button.textContent).toBe('');
    expect(button.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('adds the class it is given after the site classes', () => {
    const button = createRefreshButton(() => Promise.resolve(true), 'senkutools-example');
    expect(button.classList.contains('senkutools-example')).toBe(true);
    expect(button.classList.contains('button--icon')).toBe(true);
  });

  it('is busy while the press runs and free again when it says the button can be reused', async () => {
    let finish: (isReusable: boolean) => void = () => undefined;
    const button = createRefreshButton(() => new Promise<boolean>((resolve) => (finish = resolve)));
    button.click();
    expect(button.disabled).toBe(true);
    expect(button.getAttribute('aria-busy')).toBe('true');
    finish(true);
    await settle();
    expect(button.disabled).toBe(false);
    expect(button.hasAttribute('aria-busy')).toBe(false);
  });

  it('stays busy when the press says the page is going away', async () => {
    const button = createRefreshButton(() => Promise.resolve(false));
    button.click();
    await settle();
    expect(button.disabled).toBe(true);
    expect(button.getAttribute('aria-busy')).toBe('true');
  });
});
