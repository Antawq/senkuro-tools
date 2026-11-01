import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { isListComplete, retriggerPaging } from '../utils/shared/paging-sentinel';
import { installIntersectionObservers } from './helpers/intersection-observer';

const stylesheet = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../assets/paging-sentinel.css'), 'utf8');

const row = () => '<div class="card-collect-preview"><a class="card-collect" href="/cards/a"></a></div>';

const render = (rowCount: number, hasSentinel = true) => {
  document.body.innerHTML = `<div class="results">${row().repeat(rowCount)}${hasSentinel ? '<div class="sentinel"></div>' : ''}</div>`;
};

const results = () => document.querySelector('.results') as HTMLElement;
const sentinel = () => document.querySelector('.sentinel') as HTMLElement;
const isParked = () => sentinel().hasAttribute('data-senkutools-paging-parked');

let observers: ReturnType<typeof installIntersectionObservers>;

const cycle = () => {
  observers.report(true);
  observers.report(false);
};

beforeEach(() => {
  observers = installIntersectionObservers();
  document.head.innerHTML = `<style>${stylesheet}</style>`;
});

afterEach(() => vi.unstubAllGlobals());

describe('the end of a site list', () => {
  it('is reached when no child but the card rows is left', () => {
    render(3, false);
    expect(isListComplete(results())).toBe(true);
    render(3);
    expect(isListComplete(results())).toBe(false);
  });
});

describe('the paging sentinel of a site list', () => {
  it('is the child of the list that is not a card row', () => {
    document.body.innerHTML = `<div class="results">${row()}<div class="sentinel"></div>${row()}</div>`;
    retriggerPaging(results());
    expect(observers.observations[0]?.targets).toEqual([sentinel()]);
  });

  it('is watched with the margin the site pages with', () => {
    render(2);
    retriggerPaging(results());
    expect(observers.observations).toHaveLength(1);
    expect(observers.observations[0]?.options?.rootMargin).toBe('0px 0px 250px 0px');
    expect(observers.observations[0]?.targets).toEqual([sentinel()]);
  });

  it('is moved away only after an observer has reported it in view, and back once one has reported it gone, so the observer of the site reads each as its own first entry', () => {
    render(2);
    retriggerPaging(results());
    expect(isParked()).toBe(false);
    observers.report(true);
    expect(isParked()).toBe(true);
    observers.report(false);
    expect(isParked()).toBe(false);
    expect(observers.connected()).toHaveLength(0);
  });

  it('is parked far above with a rule of the stylesheet, where a moved box adds nothing to the scroll area, not with a style set on the site element', () => {
    render(2);
    retriggerPaging(results());
    observers.report(true);
    expect(sentinel().getAttribute('style')).toBeNull();
    expect(getComputedStyle(sentinel()).transform).toContain('translateY(-200000px)');
  });

  it('is left alone when it is outside the paging margin of the site, which sees no edge then either', () => {
    render(2);
    retriggerPaging(results());
    observers.report(false);
    expect(isParked()).toBe(false);
    expect(observers.connected()).toHaveLength(0);
  });

  it('is parked when the last entry of a batch has it in view, whatever the entries before say', () => {
    render(2);
    retriggerPaging(results());
    observers.reportBatch(false, true);
    expect(isParked()).toBe(true);
  });

  it('is left alone when the last entry of a batch has it out of view, whatever the entries before say', () => {
    render(2);
    retriggerPaging(results());
    observers.reportBatch(true, false);
    expect(isParked()).toBe(false);
    expect(observers.connected()).toHaveLength(0);
  });

  it('is left unparked by a batch with no entries', () => {
    render(2);
    retriggerPaging(results());
    expect(() => observers.reportBatch()).not.toThrow();
    expect(isParked()).toBe(false);
  });

  it('is parked once for the rows a list has, and again when rows come or go or the site draws a new sentinel', () => {
    render(2);
    retriggerPaging(results());
    cycle();
    retriggerPaging(results());
    expect(observers.observations).toHaveLength(1);
    results().insertAdjacentHTML('afterbegin', row());
    retriggerPaging(results());
    expect(observers.observations).toHaveLength(2);
    cycle();
    results().firstElementChild?.remove();
    retriggerPaging(results());
    expect(observers.observations).toHaveLength(3);
    cycle();
    sentinel().replaceWith(Object.assign(document.createElement('div'), { className: 'sentinel' }));
    retriggerPaging(results());
    expect(observers.observations).toHaveLength(4);
  });

  it('is parked again when a list goes back to the rows it had after it was complete, since the site then draws a new sentinel', () => {
    render(20);
    const list = results();
    retriggerPaging(list);
    cycle();
    list.innerHTML = row().repeat(33);
    retriggerPaging(list);
    list.innerHTML = `${row().repeat(20)}<div class="sentinel"></div>`;
    retriggerPaging(list);
    observers.report(true);
    expect(isParked()).toBe(true);
  });

  it('is parked again when the list is drawn anew with other rows of the same count', () => {
    render(2);
    retriggerPaging(results());
    cycle();
    results()
      .querySelectorAll('.card-collect-preview')
      .forEach((element) => element.replaceWith(Object.assign(document.createElement('div'), { className: 'card-collect-preview' })));
    retriggerPaging(results());
    expect(observers.observations).toHaveLength(2);
  });

  it('is parked again when only the first or only the last row of the same count is new', () => {
    const freshRow = () => Object.assign(document.createElement('div'), { className: 'card-collect-preview' });
    render(3);
    retriggerPaging(results());
    cycle();
    results().querySelector('.card-collect-preview')?.replaceWith(freshRow());
    retriggerPaging(results());
    expect(observers.observations).toHaveLength(2);
    cycle();
    [...results().querySelectorAll('.card-collect-preview')].at(-1)?.replaceWith(freshRow());
    retriggerPaging(results());
    expect(observers.observations).toHaveLength(3);
  });

  it('looks again once a park ends, so a list drawn anew meanwhile gets its own', () => {
    render(2);
    retriggerPaging(results());
    observers.report(true);
    results().insertAdjacentHTML('afterbegin', row());
    retriggerPaging(results());
    expect(observers.observations).toHaveLength(1);
    observers.report(false);
    expect(observers.observations).toHaveLength(2);
    expect(observers.connected()).toHaveLength(1);
    observers.report(true);
    expect(isParked()).toBe(true);
  });

  it('is watched by one observer at a time, so two callers give the site one edge', () => {
    render(2);
    retriggerPaging(results());
    retriggerPaging(results());
    observers.report(true);
    results().insertAdjacentHTML('afterbegin', row());
    retriggerPaging(results());
    expect(observers.observations).toHaveLength(1);
  });

  it('is not looked for in a complete list', () => {
    render(2, false);
    expect(() => retriggerPaging(results())).not.toThrow();
    expect(observers.observations).toHaveLength(0);
  });
});
