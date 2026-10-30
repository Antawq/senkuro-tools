import { parseJson } from './json';

export interface Signal<T> {
  name: string;
  encode: (detail: T) => string;
  read: (event: Event) => T | null;
}

const isRecord = (candidate: unknown): candidate is Record<string, unknown> => typeof candidate === 'object' && candidate !== null && !Array.isArray(candidate);

function readRecord(event: Event): Record<string, unknown> | null {
  const detail = (event as CustomEvent<unknown>).detail;
  const parsed = typeof detail === 'string' ? parseJson(detail) : null;
  return isRecord(parsed) ? parsed : null;
}

export function defineSignal<T>(name: string, validate: (detail: Record<string, unknown>) => T | null): Signal<T> {
  return {
    name,
    encode: (detail) => JSON.stringify(detail),
    read: (event) => {
      const record = readRecord(event);
      return record ? validate(record) : null;
    },
  };
}
