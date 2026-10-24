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

  it('looks disabled and is marked busy while the press runs, and is free again when it says the button can be reused', async () => {
    let finish: (isReusable: boolean) => void = () => undefined;
    const button = createRefreshButton(() => new Promise<boolean>((resolve) => (finish = resolve)));
    button.click();
    expect(button.getAttribute('aria-disabled')).toBe('true');
    expect(button.getAttribute('aria-busy')).toBe('true');
    expect(button.classList.contains('button--disabled')).toBe(true);
    finish(true);
    await settle();
    expect(button.hasAttribute('aria-disabled')).toBe(false);
    expect(button.hasAttribute('aria-busy')).toBe(false);
    expect(button.classList.contains('button--disabled')).toBe(false);
  });

  it('keeps the disabled attribute off, so a keyboard press does not send the focus out of the button', () => {
    const button = createRefreshButton(() => new Promise<boolean>(() => undefined));
    button.click();
    expect(button.hasAttribute('disabled')).toBe(false);
  });

  it('presses once however many times it is pressed while busy', async () => {
    let pressed = 0;
    let finish: (isReusable: boolean) => void = () => undefined;
    const button = createRefreshButton(() => {
      pressed += 1;
      return new Promise<boolean>((resolve) => (finish = resolve));
    });
    button.click();
    button.click();
    expect(pressed).toBe(1);
    finish(true);
    await settle();
    button.click();
    expect(pressed).toBe(2);
  });

  it('stays busy when the press says the page is going away', async () => {
    const button = createRefreshButton(() => Promise.resolve(false));
    button.click();
    await settle();
    expect(button.getAttribute('aria-disabled')).toBe('true');
    expect(button.getAttribute('aria-busy')).toBe('true');
  });
});
