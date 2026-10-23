export const LIST_LOAD_EVENT = 'senkutools:list-load';
export const LIST_LOADED_EVENT = 'senkutools:list-loaded';

export const encodeLoaded = (complete: boolean): string => JSON.stringify({ complete });

export function readLoaded(event: Event): boolean | null {
  const detail = (event as CustomEvent<unknown>).detail;
  if (typeof detail !== 'string') return null;
  try {
    const { complete } = JSON.parse(detail) as { complete?: unknown };
    return typeof complete === 'boolean' ? complete : null;
  } catch {
    return null;
  }
}
