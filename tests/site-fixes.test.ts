import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { beforeEach, describe, expect, it } from 'vitest';

const stylesheet = (name: string) => readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../assets', name), 'utf8');

const tradeModal = (footer: string) => `
  <div class="modal-content modal-content--trade">
    <header class="modal-trade__header"></header>
    <div class="modal-trade__body"></div>
    <div class="modal-trade__footer">${footer}</div>
  </div>`;

const styleOf = (selector: string) => getComputedStyle(document.querySelector(selector) as Element);

beforeEach(() => {
  document.head.innerHTML = `<style>${stylesheet('site-fixes.css')}</style>`;
});

describe('trade modal layout', () => {
  it('turns into a column so the body shrinks for the summary and the footer buttons stay in the box', () => {
    document.body.innerHTML = tradeModal('<div class="senkuro-trade-summary"></div><div class="modal-trade__actions"></div>');
    expect(styleOf('.modal-content--trade').display).toBe('flex');
    expect(styleOf('.modal-content--trade').flexDirection).toBe('column');
  });

  it('keeps the layout of the site while no summary is mounted in the footer', () => {
    document.body.innerHTML = tradeModal('<div class="modal-trade__actions"></div>');
    expect(styleOf('.modal-content--trade').display).not.toBe('flex');
  });
});
