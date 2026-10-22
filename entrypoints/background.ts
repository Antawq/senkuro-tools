import { defineBackground } from '#imports';
import { browser } from 'wxt/browser';

import { readAccessToken } from '@/utils/token/access-token';
import { isTokenRequest, type TokenResponse } from '@/utils/token/messages';
import { forgetRetiredData } from '@/utils/shared/retired-data';

export default defineBackground(() => {
  browser.runtime.onInstalled.addListener(() => void forgetRetiredData());

  browser.runtime.onMessage.addListener((message, sender, sendResponse: (response: TokenResponse) => void) => {
    if (!isTokenRequest(message)) return false;
    readAccessToken(sender.url).then(
      (token) => sendResponse({ token }),
      () => sendResponse({ token: null })
    );
    return true;
  });
});
