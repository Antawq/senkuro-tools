import { defineBackground } from '#imports';

export default defineBackground(() => {
  console.log('[Senkuro] background.js загружен');

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type !== 'SENKURO_GET_TOKEN') return false;

    let origin = 'https://senkuro.com';
    try {
      if (sender.url) origin = new URL(sender.url).origin;
    } catch (_) {}

    chrome.cookies.get({ url: origin, name: 'access_token' }, (cookie) => {
      if (!chrome.runtime.lastError && cookie) {
        sendResponse({ token: cookie.value });
        return;
      }
      chrome.cookies.getAll({ name: 'access_token' }, (cookies) => {
        if (chrome.runtime.lastError || !cookies) {
          console.warn('[Senkuro] cookies.getAll ошибка:', chrome.runtime.lastError);
          sendResponse({ token: null });
          return;
        }
        const match = cookies.find((c) => c.domain.includes('senkuro.com') || c.domain.includes('senkuro.me'));
        console.log('[Senkuro] найденные куки access_token:', cookies.length, '| подходящий:', match ? match.domain : 'нет');
        sendResponse({ token: match ? match.value : null });
      });
    });

    return true;
  });
});
