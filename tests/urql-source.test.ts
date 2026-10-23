import { describe, expect, it } from 'vitest';

import { make, pipe, subscribe } from 'wonka';

import { isSettled, tapSource, type SourceResult } from '../utils/shared/urql-source';

interface Result extends SourceResult {
  id: number;
}

const createResult = (id: number, extra: SourceResult = {}): Result => ({ id, ...extra });

const sourceOf = (results: Result[], complete = true) => {
  const log = { started: 0, torndown: 0 };
  const source = make<Result>((observer) => {
    log.started += 1;
    results.forEach((entry) => observer.next(entry));
    if (complete) observer.complete();
    return () => {
      log.torndown += 1;
    };
  });
  return { source, log };
};

const hooksWith = () => {
  const seen: string[] = [];
  return {
    seen,
    hooks: {
      onStart: () => seen.push('start'),
      onSettled: (entry: Result) => seen.push(`settled ${entry.id}`),
      onEnd: () => seen.push('end'),
    },
  };
};

describe('isSettled', () => {
  it('is false for a stale or streaming result only', () => {
    expect(isSettled({})).toBe(true);
    expect(isSettled({ stale: true })).toBe(false);
    expect(isSettled({ hasNext: true })).toBe(false);
  });
});

describe('tapSource', () => {
  it('reports the start, each settled result and the end, in that order', async () => {
    const { source } = sourceOf([createResult(1, { stale: true }), createResult(2)]);
    const { seen, hooks } = hooksWith();
    await tapSource(source, hooks).toPromise();
    expect(seen).toEqual(['start', 'settled 2', 'end']);
  });

  it('reports the end when the reader walks away before the source is done', () => {
    const { source, log } = sourceOf([createResult(1, { stale: true })], false);
    const { seen, hooks } = hooksWith();
    const subscription = tapSource(source, hooks).subscribe(() => undefined);
    expect(seen).toEqual(['start']);
    subscription.unsubscribe();
    expect(seen).toEqual(['start', 'end']);
    expect(log.torndown).toBe(1);
  });

  it('works when it is read as a promise, with toPromise, subscribed to, or piped through wonka', async () => {
    const reads: ((tapped: ReturnType<typeof tapSource<Result>>) => Promise<Result>)[] = [
      (tapped) => Promise.resolve(tapped.then((entry) => entry)),
      (tapped) => tapped.toPromise(),
      (tapped) => new Promise<Result>((resolve) => tapped.subscribe(resolve)),
      (tapped) =>
        new Promise<Result>((resolve) => {
          pipe(tapped, subscribe(resolve));
        }),
    ];
    for (const read of reads) {
      const { source, log } = sourceOf([createResult(5)]);
      const { seen, hooks } = hooksWith();
      expect(await read(tapSource(source, hooks))).toEqual(createResult(5));
      expect(seen).toContain('settled 5');
      expect(log.started).toBe(1);
    }
  });

  it('keeps the source working when a hook throws', async () => {
    const { source } = sourceOf([createResult(7)]);
    const tapped = tapSource(source, {
      onStart: () => {
        throw new Error('start');
      },
      onSettled: () => {
        throw new Error('settled');
      },
      onEnd: () => {
        throw new Error('end');
      },
    });
    expect(await tapped.toPromise()).toEqual(createResult(7));
  });

  it('needs no hooks at all', async () => {
    const { source } = sourceOf([createResult(9)]);
    expect(await tapSource(source, {}).toPromise()).toEqual(createResult(9));
  });
});
