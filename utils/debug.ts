export const DEBUG_KEY = 'senkutoolsDebug';

const silent = (): void => undefined;

export function debugLogger(win: Window = window): (...args: unknown[]) => void {
  try {
    if (win.localStorage.getItem(DEBUG_KEY) === null) return silent;
  } catch {
    return silent;
  }
  return (...args) => console.log('[SenkuTools]', ...args);
}
