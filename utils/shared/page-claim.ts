export function claimPage(pageWindow: object, name: string): boolean {
  const mark = Symbol.for(`senkutools.${name}`);
  const marked = pageWindow as Record<symbol, true | undefined>;
  if (marked[mark]) return false;
  marked[mark] = true;
  return true;
}
