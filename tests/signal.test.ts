import { describe, expect, it, vi } from 'vitest';

import { defineSignal } from '../utils/shared/signal';

interface Probe {
  count: number;
}

const toProbe = (detail: Record<string, unknown>): Probe | null => (typeof detail.count === 'number' ? { count: detail.count } : null);

const eventWith = (detail?: unknown) => new CustomEvent('senkutools:probe', detail === undefined ? undefined : { detail });

describe('defineSignal', () => {
  it('keeps the event name it was given', () => {
    expect(defineSignal('senkutools:probe', toProbe).name).toBe('senkutools:probe');
  });

  it('encodes a detail as its JSON text', () => {
    expect(defineSignal('senkutools:probe', toProbe).encode({ count: 2 })).toBe('{"count":2}');
  });

  it('reads back what the validator makes of an encoded detail', () => {
    const signal = defineSignal('senkutools:probe', toProbe);
    expect(signal.read(eventWith(signal.encode({ count: 3 })))).toEqual({ count: 3 });
  });

  it('gives null when the validator rejects the detail', () => {
    expect(defineSignal('senkutools:probe', toProbe).read(eventWith('{"count":"3"}'))).toBeNull();
  });

  it('gives null without asking the validator for a missing, non-text, unreadable or non-object detail', () => {
    const validate = vi.fn(toProbe);
    const signal = defineSignal('senkutools:probe', validate);
    const events = [eventWith(), eventWith({ count: 1 }), eventWith('{'), eventWith('null'), eventWith('3'), eventWith('"text"'), eventWith('[{"count":1}]')];
    expect(events.map((event) => signal.read(event))).toEqual(events.map(() => null));
    expect(validate).not.toHaveBeenCalled();
  });
});
