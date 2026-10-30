import { describe, expect, it, vi } from 'vitest';

import { GUARD_ATTRIBUTE, GUARD_READY, isGuardReady, refreshRequestSignal, refreshResultSignal, requestInventoryRefresh } from '../utils/shared/refresh-signal';
import type { ListScope } from '../utils/shared/list-scope';

const eventWith = (detail: unknown) => new CustomEvent('probe', { detail });

const answer = (scope: ListScope, outcome: 'done' | 'nothing' | 'failed') =>
  document.dispatchEvent(new CustomEvent(refreshResultSignal.name, { detail: refreshResultSignal.encode({ scope, outcome }) }));

describe('refreshRequestSignal', () => {
  it('reads the scope a request carries', () => {
    expect(refreshRequestSignal.read(eventWith(refreshRequestSignal.encode({ scope: 'grid' })))).toEqual({ scope: 'grid' });
    expect(refreshRequestSignal.read(eventWith(refreshRequestSignal.encode({ scope: 'picker' })))).toEqual({ scope: 'picker' });
  });

  it('rejects a detail that is not a string, not JSON, not an object or names another scope', () => {
    const details = [undefined, null, 1, { scope: 'grid' }, 'junk', '1', 'null', JSON.stringify({}), JSON.stringify({ scope: 'all' })];
    for (const detail of details) expect(refreshRequestSignal.read(eventWith(detail))).toBeNull();
  });
});

describe('refreshResultSignal', () => {
  it('reads the scope and the outcome', () => {
    expect(refreshResultSignal.read(eventWith(refreshResultSignal.encode({ scope: 'picker', outcome: 'nothing' })))).toEqual({
      scope: 'picker',
      outcome: 'nothing',
    });
  });

  it('rejects a result that misses a part or names an unknown one', () => {
    const details = [
      undefined,
      'junk',
      JSON.stringify({ scope: 'grid' }),
      JSON.stringify({ outcome: 'done' }),
      JSON.stringify({ scope: 'all', outcome: 'done' }),
      JSON.stringify({ scope: 'grid', outcome: 'maybe' }),
    ];
    for (const detail of details) expect(refreshResultSignal.read(eventWith(detail))).toBeNull();
  });
});

describe('isGuardReady', () => {
  it('is true only once the page guard has marked the document as ready', () => {
    const root = document.documentElement;
    root.removeAttribute(GUARD_ATTRIBUTE);
    expect(isGuardReady(document)).toBe(false);
    root.setAttribute(GUARD_ATTRIBUTE, 'unavailable');
    expect(isGuardReady(document)).toBe(false);
    root.setAttribute(GUARD_ATTRIBUTE, GUARD_READY);
    expect(isGuardReady(document)).toBe(true);
    root.removeAttribute(GUARD_ATTRIBUTE);
  });
});

describe('requestInventoryRefresh', () => {
  it('asks the page and settles with the answer for its own scope, ignoring other scopes and unreadable answers', async () => {
    const asked: (ListScope | undefined)[] = [];
    document.addEventListener(refreshRequestSignal.name, (event) => asked.push(refreshRequestSignal.read(event)?.scope), { once: true });
    const pending = requestInventoryRefresh(document, 'grid');
    answer('picker', 'failed');
    document.dispatchEvent(new CustomEvent(refreshResultSignal.name, { detail: 'junk' }));
    answer('grid', 'done');
    expect(await pending).toBe('done');
    expect(asked).toEqual(['grid']);
  });

  it('stops listening once it has an answer', async () => {
    const remove = vi.spyOn(document, 'removeEventListener');
    const pending = requestInventoryRefresh(document, 'picker');
    answer('picker', 'nothing');
    await pending;
    expect(remove).toHaveBeenCalledWith(refreshResultSignal.name, expect.any(Function));
    remove.mockRestore();
  });
});
