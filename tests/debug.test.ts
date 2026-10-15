import { afterEach, describe, expect, it, vi } from 'vitest';

import { DEBUG_KEY, debugLogger } from '../utils/debug';

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('debugLogger', () => {
  it('says nothing until the switch is set', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    debugLogger()('hidden');
    expect(log).not.toHaveBeenCalled();
  });

  it('prefixes what it says once the switch is set', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    localStorage.setItem(DEBUG_KEY, '1');
    debugLogger()('seen', { a: 1 });
    expect(log).toHaveBeenCalledWith('[SenkuTools]', 'seen', { a: 1 });
  });

  it('stays silent when the page does not let it read its storage', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const blocked = {
      get localStorage(): Storage {
        throw new DOMException('denied', 'SecurityError');
      },
    } as unknown as Window;
    expect(() => debugLogger(blocked)('hidden')).not.toThrow();
    expect(log).not.toHaveBeenCalled();
  });
});
