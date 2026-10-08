// background.js — Senkuro Card Price Extension
// Читает HttpOnly куки access_token и передаёт content-скрипту.
// document.cookie в content-скрипте НЕ видит HttpOnly куки — нужен этот bridge.

console.log('[Senkuro] background.js загружен');

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type !== 'SENKURO_GET_TOKEN') return false;

    // Берём origin из URL вкладки
    let origin = 'https://senkuro.com';
    try {
        if (sender.url) origin = new URL(sender.url).origin;
    } catch (_) {}

    // Пробуем cookies.get (точное совпадение URL)
    chrome.cookies.get({ url: origin, name: 'access_token' }, (cookie) => {
        if (!chrome.runtime.lastError && cookie) {
            sendResponse({ token: cookie.value });
            return;
        }
        // Fallback: cookies.getAll ищет по имени среди всех доменов senkuro
        // (нужно если cookie выдан на .senkuro.com а запрос с senkuro.com)
        chrome.cookies.getAll({ name: 'access_token' }, (cookies) => {
            if (chrome.runtime.lastError || !cookies) {
                console.warn('[Senkuro] cookies.getAll ошибка:', chrome.runtime.lastError);
                sendResponse({ token: null });
                return;
            }
            // Берём первый cookie подходящего домена
            const match = cookies.find(c =>
                c.domain.includes('senkuro.com') || c.domain.includes('senkuro.me')
            );
            console.log('[Senkuro] найденные куки access_token:', cookies.length,
                        '| подходящий:', match ? match.domain : 'нет');
            sendResponse({ token: match ? match.value : null });
        });
    });

    return true; // держим канал открытым для async ответа
});

