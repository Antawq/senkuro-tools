import { afterEach, describe, expect, it, vi } from 'vitest';

import { characterFilterSignal, installCharacterFilter, withCharacter } from '../utils/catalog/character-filter';

const mountApp = (route: { name: string; params: Record<string, unknown>; query: Record<string, unknown> }) => {
  const push = vi.fn(() => Promise.resolve());
  const app = document.createElement('div');
  app.id = 'app';
  Object.assign(app, { __vue_app__: { config: { globalProperties: { $router: { push, currentRoute: { value: route } } } } } });
  document.body.append(app);
  return push;
};

const send = (characterId: unknown) => document.dispatchEvent(new CustomEvent(characterFilterSignal.name, { detail: JSON.stringify({ characterId }) }));

afterEach(() => {
  document.body.innerHTML = '';
});

describe('withCharacter', () => {
  it('keeps the other filters and replaces the character filter', () => {
    expect(withCharacter([], 'C1')).toEqual(['characters', 'C1']);
    expect(withCharacter(['ranks', 's,a', 'characters', 'C0', 'animated', 'yes'], 'C1')).toEqual(['ranks', 's,a', 'animated', 'yes', 'characters', 'C1']);
  });
});

describe('installCharacterFilter', () => {
  it('pushes the card catalog route with the character filter added', () => {
    installCharacterFilter(document);
    const push = mountApp({ name: 'browse-cards', params: { fields: ['ranks', 's'] }, query: { from: 'x' } });
    send('C7');
    expect(push).toHaveBeenCalledWith({ name: 'browse-cards', params: { fields: ['ranks', 's', 'characters', 'C7'] }, query: { from: 'x' } });
  });

  it('ignores the signal outside the card catalog and a detail without a character', () => {
    installCharacterFilter(document);
    const push = mountApp({ name: 'browse-manga', params: {}, query: {} });
    send('C7');
    send('');
    send(7);
    expect(push).not.toHaveBeenCalled();
  });
});
