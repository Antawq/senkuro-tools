import { vi } from 'vitest';

interface Observation {
  callback: IntersectionObserverCallback;
  options: IntersectionObserverInit | undefined;
  targets: Element[];
  isConnected: boolean;
}

export function installIntersectionObservers() {
  const observations: Observation[] = [];
  class FakeIntersectionObserver {
    private readonly observation: Observation;

    constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
      this.observation = { callback, options, targets: [], isConnected: true };
      observations.push(this.observation);
    }

    observe(target: Element): void {
      this.observation.targets.push(target);
    }

    disconnect(): void {
      this.observation.isConnected = false;
    }
  }
  vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver);
  const connected = () => observations.filter((observation) => observation.isConnected);
  const report = (isIntersecting: boolean): void => {
    for (const observation of connected()) {
      const entries = observation.targets.map((target) => ({ target, isIntersecting }) as unknown as IntersectionObserverEntry);
      observation.callback(entries, {} as IntersectionObserver);
    }
  };
  const reportBatch = (...flags: boolean[]): void => {
    for (const observation of connected()) {
      const entries = flags.map((isIntersecting) => ({ target: observation.targets[0], isIntersecting }) as unknown as IntersectionObserverEntry);
      observation.callback(entries, {} as IntersectionObserver);
    }
  };
  return { observations, connected, report, reportBatch };
}
