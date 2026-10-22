import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { ContentScriptContext } from 'wxt/utils/content-script-context';

import type { TokenResponse } from '../utils/token/messages';
import { createTokenBar } from '../utils/token/token-bar';

const BAR = '.senkuro-token-bar';
const TOKEN = 'v4.local.token';

let run = 0;
let ctx: ContentScriptContext;
let answer: (response: TokenResponse) => void;
let sendMessage: ReturnType<typeof vi.fn>;

beforeEach(() => {
  run += 1;
  ctx = new ContentScriptContext(`token-bar-test-${run}`);
  const reply = new Promise<TokenResponse>((resolve) => {
    answer = resolve;
  });
  sendMessage = vi.fn(() => reply);
  vi.spyOn(fakeBrowser.runtime, 'sendMessage').mockImplementation(sendMessage as never);
});

afterEach(() => {
  ctx.abort();
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe('token bar setting', () => {
  it('stays hidden when the setting is turned off while the token is still on its way from the background', async () => {
    const bar = createTokenBar(ctx);
    const shown = bar.sync(true);
    expect(sendMessage).toHaveBeenCalledOnce();
    await bar.sync(false);
    answer({ token: TOKEN });
    await shown;
    expect(document.querySelector(BAR)).toBeNull();
  });

  it('removes the bar when the setting is turned off after the bar has been shown', async () => {
    const bar = createTokenBar(ctx);
    answer({ token: TOKEN });
    await bar.sync(true);
    expect(document.querySelector(BAR)).not.toBeNull();
    await bar.sync(false);
    expect(document.querySelector(BAR)).toBeNull();
  });
});
