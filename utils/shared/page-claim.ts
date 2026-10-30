const markOf = (name: string): symbol => Symbol.for(`senkutools.${name}`);

export const isPageClaimed = (pageWindow: object, name: string): boolean => Boolean((pageWindow as Record<symbol, unknown>)[markOf(name)]);

export function claimPage(pageWindow: object, name: string): boolean {
  if (isPageClaimed(pageWindow, name)) return false;
  (pageWindow as Record<symbol, true>)[markOf(name)] = true;
  return true;
}
