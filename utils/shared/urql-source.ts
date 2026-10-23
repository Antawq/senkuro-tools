import { filter, onEnd, onPush, pipe, subscribe, take, toPromise } from 'wonka';
import type { Sink } from 'wonka';

export interface SourceResult {
  stale?: boolean;
  hasNext?: boolean;
}

export interface TapHooks<T extends SourceResult> {
  onStart?: () => void;
  onSettled?: (sourceResult: T) => void;
  onEnd?: () => void;
}

export interface TappedSource<T extends SourceResult> {
  (sink: Sink<T>): void;
  toPromise(): Promise<T>;
  then: PromiseLike<T>['then'];
  subscribe(onResult: (sourceResult: T) => void): { unsubscribe(): void };
}

export const isSettled = (sourceResult: SourceResult): boolean => !sourceResult.stale && !sourceResult.hasNext;

function callGuarded(run: (() => void) | undefined): () => void {
  return () => {
    try {
      run?.();
    } catch {
      return;
    }
  };
}

export function tapSource<T extends SourceResult>(source: (sink: Sink<T>) => void, hooks: TapHooks<T>): TappedSource<T> {
  const piped = pipe(
    source,
    onPush((sourceResult: T) => {
      if (isSettled(sourceResult)) callGuarded(() => hooks.onSettled?.(sourceResult))();
    }),
    onEnd(callGuarded(hooks.onEnd))
  );
  const wrapped = (sink: Sink<T>): void => {
    callGuarded(hooks.onStart)();
    piped(sink);
  };
  const firstSettledResult = (): Promise<T> =>
    pipe(
      wrapped,
      filter((sourceResult: T) => isSettled(sourceResult)),
      take(1),
      toPromise
    );
  return Object.assign(wrapped, {
    toPromise: firstSettledResult,
    then: ((resolve, reject) => firstSettledResult().then(resolve, reject)) as PromiseLike<T>['then'],
    subscribe: (onResult: (sourceResult: T) => void) => subscribe(onResult)(wrapped),
  });
}
