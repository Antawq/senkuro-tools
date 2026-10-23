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

describe('avatar price coin', () => {
  it('is sized with the text it stands in, and wins over the image rules of the site', () => {
    document.head.insertAdjacentHTML('afterbegin', '<style>img{vertical-align:middle;max-width:100%}</style>');
    document.body.innerHTML = '<div class="modal-alert__desc"><span>5000<img class="senkutools-avatar-coin"></span></div>';
    const coin = styleOf('.senkutools-avatar-coin');
    expect(coin.height).toBe('22.4px');
    expect(coin.width).toBe('auto');
    expect(coin.verticalAlign).toBe('-0.3em');
    expect(coin.marginLeft).toBe('4px');
    expect(coin.marginRight).toBe('-2.4px');
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
