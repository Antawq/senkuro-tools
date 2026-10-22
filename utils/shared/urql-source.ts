import { filter, onEnd, onPush, pipe, subscribe, take, toPromise } from 'wonka';
import type { Sink } from 'wonka';

export interface SourceResult {
  stale?: boolean;
  hasNext?: boolean;
}

export interface TapHooks<T extends SourceResult> {
  start?: () => void;
  settled?: (result: T) => void;
  end?: () => void;
}

export interface TappedSource<T extends SourceResult> {
  (sink: Sink<T>): void;
  toPromise(): Promise<T>;
  then: PromiseLike<T>['then'];
  subscribe(callback: (result: T) => void): { unsubscribe(): void };
}

export const isSettled = (result: SourceResult): boolean => !result.stale && !result.hasNext;

function guarded(run: (() => void) | undefined): () => void {
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
    onPush((result: T) => {
      if (isSettled(result)) guarded(() => hooks.settled?.(result))();
    }),
    onEnd(guarded(hooks.end))
  );
  const wrapped = (sink: Sink<T>): void => {
    guarded(hooks.start)();
    piped(sink);
  };
  const settled = (): Promise<T> =>
    pipe(
      wrapped,
      filter((result: T) => isSettled(result)),
      take(1),
      toPromise
    );
  return Object.assign(wrapped, {
    toPromise: settled,
    then: ((resolve, reject) => settled().then(resolve, reject)) as PromiseLike<T>['then'],
    subscribe: (callback: (result: T) => void) => subscribe(callback)(wrapped),
  });
}
