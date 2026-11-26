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

const profileHeader = (extra: string) => `
  <div class="client-header">
    <header><h1>Tantumque_Profecit</h1>${extra}</header>
  </div>`;

const styleOf = (selector: string) => getComputedStyle(document.querySelector(selector) as Element);

beforeEach(() => {
  document.head.innerHTML = `<style>${stylesheet('profile-badge.css')}${stylesheet('site-fixes.css')}</style>`;
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

describe('window toolbars with the lock filter or the search', () => {
  it.each(['senkutools-lock-filter', 'senkutools-modal-search'])('may wrap with the %s, so a narrow window gets a second row instead of an overflow', (own) => {
    document.body.innerHTML = `<div class="modal-trade__header-form"><button></button><div class="${own}"></div></div>`;
    expect(styleOf('.modal-trade__header-form').flexWrap).toBe('wrap');
  });
});

describe('card list toolbars with the price range control', () => {
  it('may wrap, so the control and the refresh button never push past the edge of a narrow window', () => {
    for (const toolbar of ['modal-trade__header-form', 'card-browse__form']) {
      document.body.innerHTML = `<div class="${toolbar}"><button></button><div class="senkutools-price-filter"></div></div>`;
      expect(styleOf(`.${toolbar}`).flexWrap).toBe('wrap');
      document.body.innerHTML = `<div class="${toolbar}"><button></button></div>`;
      expect(styleOf(`.${toolbar}`).flexWrap).not.toBe('wrap');
    }
  });
});

describe('a price range that leaves a list empty', () => {
  it('hides the empty message of the site, because the note of the range stands in the list instead', () => {
    document.body.innerHTML =
      '<section data-senkutools-price-empty><div class="empty"></div><div class="senkutools-price-filter__empty"></div></section><section><div class="empty"></div></section>';
    expect(styleOf('[data-senkutools-price-empty] > .empty').display).toBe('none');
    expect(styleOf('section:not([data-senkutools-price-empty]) > .empty').display).not.toBe('none');
  });
});

describe('avatar price coin', () => {
  it('is sized with the text it stands in, and wins over the image rules of the site', () => {
    document.head.insertAdjacentHTML('afterbegin', '<style>img{vertical-align:middle;max-width:100%}</style>');
    document.body.innerHTML = '<div class="modal-alert__desc"><span>5000<img class="senkutools-avatar-coin"></span></div>';
    const coinStyle = styleOf('.senkutools-avatar-coin');
    expect(coinStyle.height).toBe('22.4px');
    expect(coinStyle.width).toBe('auto');
    expect(coinStyle.verticalAlign).toBe('-0.3em');
    expect(coinStyle.marginLeft).toBe('4px');
    expect(coinStyle.marginRight).toBe('-2.4px');
  });
});

describe('profile header layout', () => {
  it('wraps once it holds the value chip so a long nickname does not push the chip out of the card', () => {
    document.body.innerHTML = profileHeader('<div class="senkuro-profile-f-chip"></div>');
    expect(styleOf('.client-header header').flexWrap).toBe('wrap');
  });

  it('keeps the header of the site as it is without the chip', () => {
    document.body.innerHTML = profileHeader('');
    expect(styleOf('.client-header header').flexWrap).not.toBe('wrap');
  });

  it('puts the chip behind the status icons of the nickname, so wrapping moves only the chip', () => {
    document.body.innerHTML = `${profileHeader('<div class="senkuro-profile-f-chip"></div><span class="emoji-status"></span>')}<div class="nav-mobile__left"><div class="senkuro-profile-f-chip"></div></div>`;
    expect(styleOf('.client-header header > .senkuro-profile-f-chip').order).toBe('1');
    expect(styleOf('.client-header header > .emoji-status').order).not.toBe('1');
    expect(styleOf('.nav-mobile__left > .senkuro-profile-f-chip').order).not.toBe('1');
  });

  it('lines the chip up with the nickname when it wraps, and keeps its own offset elsewhere', () => {
    document.body.innerHTML = `${profileHeader('<div class="senkuro-profile-f-chip"></div>')}<div class="nav-mobile__left"><div class="senkuro-profile-f-chip"></div></div>`;
    expect(styleOf('.client-header header > .senkuro-profile-f-chip').marginLeft).toMatch(/^0(px)?$/);
    expect(styleOf('.nav-mobile__left > .senkuro-profile-f-chip').marginLeft).toBe('6px');
  });
});

const previewCards = (cards: number, withTile: boolean) =>
  `<div class="card-preview-list__cards">${'<div class="card-preview-list__card"></div>'.repeat(cards)}${withTile ? '<div class="card-preview-list__el"></div>' : ''}</div>`;

const reviewStep = (cards: number, withTile: boolean) =>
  `<div class="modal-content modal-content--trade"><div class="modal-trade__swap"><div class="modal-trade__swap-el"><div class="card-preview-list">${previewCards(cards, withTile)}</div></div></div></div>`;

describe('trade window frame', () => {
  it('paints the window and its three bands like the previous design, without the new border', () => {
    document.head.insertAdjacentHTML('beforeend', '<style>:root{--bg-primary:rgb(1, 2, 3);--bg-quaternary:rgb(4, 5, 6)}</style>');
    document.body.innerHTML = tradeModal('');
    expect(styleOf('.modal-content--trade').backgroundColor).toBe('rgb(1, 2, 3)');
    expect(styleOf('.modal-content--trade').borderWidth).toMatch(/^0(px)?$/);
    for (const band of ['header', 'body', 'footer']) expect(styleOf(`.modal-trade__${band}`).backgroundColor).toBe('rgb(4, 5, 6)');
    expect(styleOf('.modal-trade__body').maxHeight).toBe('398px');
  });
});

describe('review step card fan', () => {
  it('tilts the second card left and the third card right', () => {
    document.body.innerHTML = reviewStep(3, false);
    expect(styleOf('.card-preview-list__card:nth-child(2)').transform).toBe('rotate(-10deg) translate(-54px, -6px)');
    expect(styleOf('.card-preview-list__card:nth-child(3)').transform).toBe('rotate(10deg) translate(54px, -6px)');
    expect(styleOf('.card-preview-list__card:nth-child(2)').position).toBe('absolute');
  });

  it('moves the second card one step further left when the view all tile takes the third place', () => {
    document.body.innerHTML = reviewStep(2, true);
    expect(styleOf('.card-preview-list__card:nth-child(2)').transform).toBe('rotate(-10deg) translate(-108px, -6px)');
  });

  it('keeps the first card and the view all tile upright and in the flow', () => {
    document.body.innerHTML = reviewStep(2, true);
    for (const upright of ['.card-preview-list__card:first-child', '.card-preview-list__el']) {
      expect(styleOf(upright).transform).not.toContain('rotate');
      expect(styleOf(upright).position).not.toBe('absolute');
    }
  });

  it('leaves the card lists outside of the review step alone', () => {
    document.body.innerHTML = `<div class="card-trade"><div class="card-preview-list">${previewCards(3, false)}</div></div>`;
    for (const card of document.querySelectorAll<HTMLElement>('.card-preview-list__card')) expect(getComputedStyle(card).position).not.toBe('absolute');
  });
});

describe('trade count pills', () => {
  const summary = (state = '') => `<div class="senkuro-trade-summary${state}"></div>`;
  const reviewPills = (footer: string) =>
    `<div class="modal-content modal-content--trade"><div class="card-preview-list__quantity"></div><div class="modal-trade__swap-quantity"></div><div class="modal-trade__footer">${footer}</div></div>`;
  const historyItem = (tail: string) =>
    `<div class="card-trade"><div class="card-preview-list"><div class="card-preview-list__quantity"></div></div>${tail}</div>`;

  it('are hidden in the review step while the summary shows the exchange', () => {
    document.body.innerHTML = reviewPills(summary());
    expect(styleOf('.card-preview-list__quantity').display).toBe('none');
    expect(styleOf('.modal-trade__swap-quantity').display).toBe('none');
  });

  it.each([
    ['no summary', ''],
    ['a closed summary', summary(' senkuro-trade-summary--closed')],
  ])('stay in the review step with %s', (_name, footer) => {
    document.body.innerHTML = reviewPills(footer);
    expect(styleOf('.card-preview-list__quantity').display).not.toBe('none');
    expect(styleOf('.modal-trade__swap-quantity').display).not.toBe('none');
  });

  it('are hidden only in the history items that carry a summary', () => {
    document.body.innerHTML = historyItem(summary()) + historyItem('') + historyItem(summary(' senkuro-trade-summary--closed'));
    const [withSummary, withoutSummary, withClosedSummary] = [...document.querySelectorAll('.card-preview-list__quantity')].map(
      (pill) => getComputedStyle(pill).display
    );
    expect(withSummary).toBe('none');
    expect(withoutSummary).not.toBe('none');
    expect(withClosedSummary).not.toBe('none');
  });
});

describe('trade history card lists', () => {
  it('lay the cards out in the grid of the previous design', () => {
    document.body.innerHTML = `<div class="user-card-trades-grid"><div class="card-trade"><div class="card-preview-list"><div class="card-preview-list__cards"></div></div></div></div>`;
    expect(styleOf('.card-preview-list__cards').gridTemplateColumns).toBe('repeat(auto-fill, minmax(88px, 1fr))');
    expect(styleOf('.card-preview-list__cards').gap).toBe('8px');
  });

  it('flow the trades into as many columns as fit a minimal trade width', () => {
    document.body.innerHTML = '<div class="user-card-trades-grid"><div class="card-trade"></div></div><div class="user-card-trades-grid" id="empty"></div>';
    expect(styleOf('.user-card-trades-grid:not(#empty)').gridTemplateColumns).toBe('repeat(auto-fill, minmax(240px, 1fr))');
    expect(styleOf('#empty').gridTemplateColumns).not.toBe('repeat(auto-fill, minmax(240px, 1fr))');
  });

  it('let the time label fill the row so it sits at the far end of the header', () => {
    document.body.innerHTML =
      '<div class="card-trade"><div class="card-preview-list"><div class="card-preview-list__top"><div class="card-list"></div></div></div></div>';
    expect(styleOf('.card-list').flexGrow).toBe('1');
  });

  it('drop the level chip, in the review step too, and keep it on other pages', () => {
    const list = '<div class="card-preview-list"><div class="card-type"></div></div>';
    document.body.innerHTML = `<div class="card-trade">${list}</div><div class="modal-trade__swap-el">${list}</div><div class="profile">${list}</div>`;
    const [history, review, elsewhere] = [...document.querySelectorAll('.card-type')].map((chip) => getComputedStyle(chip).display);
    expect(history).toBe('none');
    expect(review).toBe('none');
    expect(elsewhere).not.toBe('none');
  });
});

describe('selected cards in the profile', () => {
  it('draw the selection frame inside a shard, which clips everything outside its box', () => {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(stylesheet('site-fixes.css'));
    const frames = [...sheet.cssRules].filter(
      (rule): rule is CSSStyleRule =>
        rule instanceof CSSStyleRule && rule.selectorText.includes('::after') && rule.selectorText.includes('.user-card--selected')
    );
    expect(frames.map((rule) => rule.selectorText)).toEqual(['.user-card--selected.card-collect-preview--shard::after']);
    expect(frames[0]?.style.getPropertyValue('inset')).toBe('0');
    expect(frames[0]?.style.getPropertyValue('border-radius')).toBe('var(--senkuro-shard-radius)');
    expect(stylesheet('tokens.css')).toContain('--senkuro-shard-radius: 8.8%;');
  });
});
