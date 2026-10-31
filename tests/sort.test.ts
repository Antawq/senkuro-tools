import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Window as HappyWindow } from 'happy-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const stylesheet = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../assets/sort.css'), 'utf8');

const DESKTOP_WIDTH_PX = 1280;
const PHONE_WIDTH_PX = 360;

const toolbar = (mobileClass: string) => `
  <div class="toolbar">
    <button class="${mobileClass} button senkutools-price-filter__trigger">
      <svg class="price-tag"></svg><span>Цена</span><svg class="senkutools-price-filter__chevron"></svg>
    </button>
  </div>`;

const trigger = () => getComputedStyle(document.querySelector('.senkutools-price-filter__trigger') as Element);
const chevron = () => getComputedStyle(document.querySelector('.senkutools-price-filter__chevron') as Element);

const setWidth = (widthPx: number) => (window as unknown as HappyWindow).happyDOM.setViewport({ width: widthPx, height: 800 });

beforeEach(() => {
  document.head.innerHTML = `<style>:root{--height-md:36px}${stylesheet}</style>`;
});

afterEach(() => setWidth(DESKTOP_WIDTH_PX));

describe('the price range trigger in the window and deck builder toolbars', () => {
  it('is a square icon button on phones, the size of the icon buttons of the site, with no chevron', () => {
    setWidth(PHONE_WIDTH_PX);
    for (const mobileClass of ['modal-trade__header-form__mob', 'card-browse__form__mob']) {
      document.body.innerHTML = toolbar(mobileClass);
      expect(trigger().width).toBe('36px');
      expect(trigger().paddingLeft).toBe('0px');
      expect(chevron().display).toBe('none');
    }
  });

  it('keeps the chevron and its own width from 992px', () => {
    setWidth(DESKTOP_WIDTH_PX);
    document.body.innerHTML = toolbar('modal-trade__header-form__mob');
    expect(trigger().width).not.toBe('36px');
    expect(chevron().display).not.toBe('none');
  });

  it('keeps the chevron on the profile cards bar, where the site keeps its own labels on phones', () => {
    setWidth(PHONE_WIDTH_PX);
    document.body.innerHTML = toolbar('');
    expect(trigger().width).not.toBe('36px');
    expect(chevron().display).not.toBe('none');
  });
});
