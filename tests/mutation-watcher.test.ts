import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createFrameWatcher, createMutationFilter } from '../utils/trades/mutation-watcher';

const record = (target: Node, addedNodes: Node[] = [], removedNodes: Node[] = []) => ({ target, addedNodes, removedNodes }) as unknown as MutationRecord;

const element = (markup: string): Element => {
  const holder = document.createElement('div');
  holder.innerHTML = markup;
  return holder.firstElementChild as Element;
};

describe('createMutationFilter', () => {
  const isRelevant = createMutationFilter('.place', '.own, .own-note');

  beforeEach(() => {
    document.body.innerHTML = '<div class="place"><div class="inner"></div></div><div class="elsewhere"></div>';
  });

  it('accepts a change inside a place', () => {
    expect(isRelevant(record(document.querySelector('.inner') as Node, [document.createElement('span')]))).toBe(true);
  });

  it('accepts a place that is added, or that an added node holds', () => {
    expect(isRelevant(record(document.body, [element('<div class="place"></div>')]))).toBe(true);
    expect(isRelevant(record(document.body, [element('<div><div class="place"></div></div>')]))).toBe(true);
  });

  it('ignores a change outside a place', () => {
    expect(isRelevant(record(document.querySelector('.elsewhere') as Node, [document.createElement('span')]))).toBe(false);
  });

  it('ignores the nodes the extension adds or removes itself, whichever kind they are', () => {
    const inner = document.querySelector('.inner') as Node;
    for (const own of [element('<button class="own"></button>'), element('<p class="own-note"></p>')]) {
      expect(isRelevant(record(inner, [own]))).toBe(false);
      expect(isRelevant(record(inner, [], [own]))).toBe(false);
    }
  });

  it('counts an own node that arrives together with a node of the site', () => {
    expect(isRelevant(record(document.querySelector('.inner') as Node, [element('<button class="own"></button>'), document.createElement('span')]))).toBe(true);
  });

  it('ignores a change inside an own node', () => {
    const own = element('<button class="own"><span></span></button>');
    (document.querySelector('.inner') as Node).appendChild(own);
    expect(isRelevant(record(own.firstChild as Node, [document.createElement('i')]))).toBe(false);
  });

  it('reads the parent of a text node as its place', () => {
    const text = document.createTextNode('1');
    (document.querySelector('.inner') as Node).appendChild(text);
    expect(isRelevant(record(text))).toBe(true);
  });
});

describe('createFrameWatcher', () => {
  const relevantTarget = document.createElement('div');
  const otherTarget = document.createElement('div');
  const setup = () => {
    const frames: (() => void)[] = [];
    const sync = vi.fn();
    const watcher = createFrameWatcher(
      (mutation) => mutation.target === relevantTarget,
      sync,
      (run) => frames.push(run)
    );
    return { frames, sync, watcher };
  };

  it('syncs once in the next frame however many relevant mutations came before it', () => {
    const { frames, sync, watcher } = setup();
    watcher.watch([record(relevantTarget), record(relevantTarget)]);
    watcher.watch([record(relevantTarget)]);
    expect(frames).toHaveLength(1);
    expect(sync).not.toHaveBeenCalled();
    frames[0]?.();
    expect(sync).toHaveBeenCalledTimes(1);
  });

  it('asks for another frame once the first one has run', () => {
    const { frames, sync, watcher } = setup();
    watcher.watch([record(relevantTarget)]);
    frames[0]?.();
    watcher.watch([record(relevantTarget)]);
    expect(frames).toHaveLength(2);
    frames[1]?.();
    expect(sync).toHaveBeenCalledTimes(2);
  });

  it('does nothing for mutations it is not interested in', () => {
    const { frames, watcher } = setup();
    watcher.watch([record(otherTarget)]);
    expect(frames).toHaveLength(0);
  });
});
