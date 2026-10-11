import { defineBackground } from '#imports';
import { browser } from 'wxt/browser';

import { readAccessToken } from '@/utils/access-token';
import { isTokenRequest, type TokenResponse } from '@/utils/messages';

export default defineBackground(() => {
  browser.runtime.onMessage.addListener((message, sender, sendResponse: (response: TokenResponse) => void) => {
    if (!isTokenRequest(message)) return false;
    readAccessToken(sender.url).then(
      (token) => sendResponse({ token }),
      () => sendResponse({ token: null })
    );
    return true;
  });
});
