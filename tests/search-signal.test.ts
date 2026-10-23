import { describe, expect, it } from 'vitest';

import { createSearchSignals, type SearchSignal } from '../utils/search/search-signal';

const event = (signal: Partial<SearchSignal>) => new CustomEvent('senkutools:search', { detail: JSON.stringify(signal) });
const start = (query = 'naruto') => event({ phase: 'start', query, type: 'MANGA' });
const done = (query = 'naruto') => event({ phase: 'done', query, type: 'MANGA' });

const clocked = () => {
  const clock = { time: 1000 };
  return { clock, signals: createSearchSignals(() => clock.time) };
};

describe('search signals', () => {
  it('knows nothing until the page-world script has spoken', () => {
    const { signals } = clocked();
    expect(signals.hasSeenSignal()).toBe(false);
    expect(signals.isSearchPending()).toBe(false);
    expect(signals.doneAt()).toBe(0);
  });

  it('is pending from a start until its done', () => {
    const { clock, signals } = clocked();
    signals.event(start());
    expect(signals.hasSeenSignal()).toBe(true);
    expect(signals.isSearchPending()).toBe(true);
    clock.time = 1300;
    signals.event(done());
    expect(signals.isSearchPending()).toBe(false);
    expect(signals.doneAt()).toBe(1300);
  });

  it('tells how long the oldest search in flight has been waiting', () => {
    const { clock, signals } = clocked();
    expect(signals.waited()).toBe(0);
    signals.event(start('nar'));
    clock.time = 1400;
    signals.event(start('naruto'));
    clock.time = 1700;
    expect(signals.waited()).toBe(700);
    signals.event(done('nar'));
    expect(signals.waited()).toBe(300);
    signals.event(done('naruto'));
    expect(signals.waited()).toBe(0);
  });

  it('does not count a search it has stopped waiting for', () => {
    const { clock, signals } = clocked();
    signals.event(start());
    clock.time = 1000 + 5000;
    expect(signals.waited()).toBe(0);
  });

  it('counts overlapping searches and stays pending until each is done', () => {
    const { signals } = clocked();
    signals.event(start('nar'));
    signals.event(start('naruto'));
    signals.event(done('nar'));
    expect(signals.isSearchPending()).toBe(true);
    signals.event(done('naruto'));
    expect(signals.isSearchPending()).toBe(false);
  });

  it('stops waiting for a search that never reports back', () => {
    const { clock, signals } = clocked();
    signals.event(start());
    clock.time = 1000 + 4999;
    expect(signals.isSearchPending()).toBe(true);
    clock.time = 1000 + 5000;
    expect(signals.isSearchPending()).toBe(false);
  });

  it('ignores events it cannot read', () => {
    const { signals } = clocked();
    signals.event(new CustomEvent('senkutools:search'));
    signals.event(new CustomEvent('senkutools:search', { detail: 'not json' }));
    signals.event(new CustomEvent('senkutools:search', { detail: JSON.stringify({ phase: 'later', query: 'x' }) }));
    signals.event(new CustomEvent('senkutools:search', { detail: JSON.stringify({ phase: 'start' }) }));
    expect(signals.hasSeenSignal()).toBe(false);
  });

  it('tells its listeners about every event it understood', () => {
    const { signals } = clocked();
    let heard = 0;
    signals.subscribe(() => (heard += 1));
    signals.event(start());
    signals.event(new CustomEvent('senkutools:search', { detail: 'not json' }));
    signals.event(done());
    expect(heard).toBe(2);
  });
});
