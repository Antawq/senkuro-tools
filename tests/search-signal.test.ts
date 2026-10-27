import { describe, expect, it } from 'vitest';

import { createSearchSignals } from '../utils/search/search-signal';
import type { SearchSignal } from '../utils/search/search-event';

const event = (signal: Partial<SearchSignal>) => new CustomEvent('senkutools:search', { detail: JSON.stringify(signal) });
const start = (query = 'naruto') => event({ phase: 'start', query, type: 'MANGA' });
const done = (query = 'naruto', firstSlug: string | null = 'naruto-first') => event({ phase: 'done', query, type: 'MANGA', settled: true, firstSlug });
const cancelled = (query = 'naruto') => event({ phase: 'done', query, type: 'MANGA' });

const clocked = () => {
  const clock = { time: 1000 };
  return { clock, signals: createSearchSignals(() => clock.time) };
};

describe('search signals', () => {
  it('knows nothing until the page-world script has spoken', () => {
    const { signals } = clocked();
    expect(signals.hasSeenSignal()).toBe(false);
    expect(signals.isSearchPending()).toBe(false);
    expect(signals.lastSettled()).toBeNull();
  });

  it('is pending from a start until its done', () => {
    const { clock, signals } = clocked();
    signals.handleEvent(start());
    expect(signals.hasSeenSignal()).toBe(true);
    expect(signals.isSearchPending()).toBe(true);
    clock.time = 1300;
    signals.handleEvent(done());
    expect(signals.isSearchPending()).toBe(false);
  });

  it('remembers what the last settled search asked and which result came first', () => {
    const { signals } = clocked();
    signals.handleEvent(start('nar'));
    signals.handleEvent(done('nar', 'naruto-gaiden'));
    expect(signals.lastSettled()).toEqual({ query: 'nar', firstSlug: 'naruto-gaiden' });
    signals.handleEvent(start('naruto'));
    signals.handleEvent(done('naruto', 'naruto'));
    expect(signals.lastSettled()).toEqual({ query: 'naruto', firstSlug: 'naruto' });
  });

  it('takes a search that found nothing for an answer with no first result', () => {
    const { signals } = clocked();
    signals.handleEvent(start('zzzz'));
    signals.handleEvent(done('zzzz', null));
    expect(signals.lastSettled()).toEqual({ query: 'zzzz', firstSlug: null });
    signals.handleEvent(event({ phase: 'done', query: 'qqqq', type: 'MANGA', settled: true, firstSlug: 5 as unknown as string }));
    expect(signals.lastSettled()).toEqual({ query: 'qqqq', firstSlug: null });
  });

  it('does not take a search the page gave up on for an answer', () => {
    const { signals } = clocked();
    signals.handleEvent(start('nar'));
    signals.handleEvent(done('nar', 'naruto-gaiden'));
    signals.handleEvent(start('naruto'));
    signals.handleEvent(cancelled('naruto'));
    expect(signals.isSearchPending()).toBe(false);
    expect(signals.lastSettled()).toEqual({ query: 'nar', firstSlug: 'naruto-gaiden' });
  });

  it('tells how long the oldest search in flight has been waiting', () => {
    const { clock, signals } = clocked();
    expect(signals.waited()).toBe(0);
    signals.handleEvent(start('nar'));
    clock.time = 1400;
    signals.handleEvent(start('naruto'));
    clock.time = 1700;
    expect(signals.waited()).toBe(700);
    signals.handleEvent(done('nar'));
    expect(signals.waited()).toBe(300);
    signals.handleEvent(done('naruto'));
    expect(signals.waited()).toBe(0);
  });

  it('does not count a search it has stopped waiting for', () => {
    const { clock, signals } = clocked();
    signals.handleEvent(start());
    clock.time = 1000 + 5000;
    expect(signals.waited()).toBe(0);
  });

  it('counts overlapping searches and stays pending until each is done', () => {
    const { signals } = clocked();
    signals.handleEvent(start('nar'));
    signals.handleEvent(start('naruto'));
    signals.handleEvent(done('nar'));
    expect(signals.isSearchPending()).toBe(true);
    signals.handleEvent(done('naruto'));
    expect(signals.isSearchPending()).toBe(false);
  });

  it('stops waiting for a search that never reports back', () => {
    const { clock, signals } = clocked();
    signals.handleEvent(start());
    clock.time = 1000 + 4999;
    expect(signals.isSearchPending()).toBe(true);
    clock.time = 1000 + 5000;
    expect(signals.isSearchPending()).toBe(false);
  });

  it('ignores events it cannot read', () => {
    const { signals } = clocked();
    signals.handleEvent(new CustomEvent('senkutools:search'));
    signals.handleEvent(new CustomEvent('senkutools:search', { detail: 'not json' }));
    signals.handleEvent(new CustomEvent('senkutools:search', { detail: JSON.stringify({ phase: 'later', query: 'x' }) }));
    signals.handleEvent(new CustomEvent('senkutools:search', { detail: JSON.stringify({ phase: 'start' }) }));
    expect(signals.hasSeenSignal()).toBe(false);
  });

  it('tells its listeners about every event it understood', () => {
    const { signals } = clocked();
    let heard = 0;
    signals.subscribe(() => (heard += 1));
    signals.handleEvent(start());
    signals.handleEvent(new CustomEvent('senkutools:search', { detail: 'not json' }));
    signals.handleEvent(done());
    expect(heard).toBe(2);
  });
});
