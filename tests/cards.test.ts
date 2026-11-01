import { beforeEach, describe, expect, it } from 'vitest';

import { findShownName } from '../utils/shared/cards';

const card = (frontImage: string) =>
  `<a class="card-collect" href="/cards/a-b-f"><div class="card-collect__front">${frontImage}</div><div class="card-collect__back"><img class="card-collect__img" alt="Рубашка карты Аркемис"></div></a>`;

const link = () => document.querySelector('a.card-collect') as HTMLAnchorElement;

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('findShownName', () => {
  it('reads the alt of the front image, trimmed', () => {
    document.body.innerHTML = card('<img class="card-collect__img" alt=" Тан Чонхак ">');
    expect(findShownName(link())).toBe('Тан Чонхак');
  });

  it('never reads the back of the card', () => {
    document.body.innerHTML = card('<video></video>');
    expect(findShownName(link())).toBeNull();
  });

  it('is null for an empty alt', () => {
    document.body.innerHTML = card('<img class="card-collect__img" alt="">');
    expect(findShownName(link())).toBeNull();
  });
});
