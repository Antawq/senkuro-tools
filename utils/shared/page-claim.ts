export function claimPage(win: object, name: string): boolean {
  const mark = Symbol.for(`senkutools.${name}`);
  const marked = win as Record<symbol, true | undefined>;
  if (marked[mark]) return false;
  marked[mark] = true;
  return true;
}
