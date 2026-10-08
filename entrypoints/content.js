import '@/assets/trade-summary.css';
import { defineContentScript } from '#imports';
import { effectivePrice, slugFromHref } from '@/utils/cards.js';
import { createTradeStore, listenForTrades } from '@/utils/trade-capture.js';
import { isTradeMutation, updateTradeSummaries } from '@/utils/trade-summary.js';

export default defineContentScript({
  matches: ['*://*.senkuro.com/*', '*://*.senkuro.me/*'],
  runAt: 'document_idle',
  main() {
    let database = null;
    let useCommission = true;
    let badgeOpacity = 75;
    let badgeStyle = 'background';
    let badgeFontSize = 16;
    let badgePosition = 'bottom-right';
    let showCopyBtn = false;
    let copyBtnSize = 18;
    let showToken = false;
    let effectRed = 'price-effect-rgb';
    let effectPurple = 'price-effect-tilt';
    let effectYellow = 'price-effect-bg';
    let effectGreen = 'price-effect-pulse';
    let effectWhite = '';

    const isTouchDevice = navigator.maxTouchPoints > 0 || 'ontouchstart' in window;

    const tradeStore = createTradeStore();

    const srcCache = new Map();

    const loadBoundImgs = new WeakSet();

    const positionedTargets = new WeakSet();

    let senkuroLogged = false;

    let _lastPathname = location.pathname;

    let _isRendering = false;

    if (!document.getElementById('senkuro-price-effects')) {
      const style = document.createElement('style');
      style.id = 'senkuro-price-effects';
      style.textContent = `
                .card-collect-preview__front[data-senkuro-price],
                .card-collect-preview[data-senkuro-price],
                a.card-collect[data-senkuro-price] {
                    isolation: isolate;
                }

                .card-collect-preview__front[data-senkuro-price]::after,
                .card-collect-preview[data-senkuro-price]::after,
                a.card-collect[data-senkuro-price]::after {
                    content: attr(data-senkuro-price);
                    position: absolute;
                    z-index: 99;
                    pointer-events: none;
                    font-weight: bold;
                    white-space: nowrap;
                    text-decoration: none;
                    display: inline-block;
                    color: var(--s-color, #fff);
                    font-size: var(--s-size, 14px);
                    top: var(--s-top, auto);
                    bottom: var(--s-bottom, auto);
                    left: var(--s-left, auto);
                    right: var(--s-right, auto);
                    margin-top: var(--s-mt, 0);
                    margin-left: var(--s-ml, 0);
                    text-align: var(--s-align, left);
                    max-width: 70px;
                    overflow: hidden;
                    will-change: transform, opacity;
                    transform: translateZ(0);
                    backface-visibility: hidden;
                    -webkit-backface-visibility: hidden;
                }

                .card-collect-preview__front[data-senkuro-style="background"]::after,
                .card-collect-preview[data-senkuro-style="background"]::after,
                a.card-collect[data-senkuro-style="background"]::after {
                    background-color: var(--s-bg-color, rgba(0,0,0,0.75));
                    padding: var(--s-pad, 2px 6px);
                    border-radius: 4px;
                }

                .card-collect-preview__front[data-senkuro-style="outline"]::after,
                .card-collect-preview[data-senkuro-style="outline"]::after,
                a.card-collect[data-senkuro-style="outline"]::after {
                    background-color: transparent;
                    padding: 0;
                    text-shadow: var(--s-outline, none);
                }


                @keyframes senkuro-pulse-text {
                    0%   { transform: translateZ(0) scale(1);    opacity: 1;   }
                    100% { transform: translateZ(0) scale(1.15); opacity: 0.7; }
                }
                [data-senkuro-eff="price-effect-pulse"]::after {
                    animation: senkuro-pulse-text 1.2s infinite alternate ease-in-out 0.15s;
                    transform-origin: center;
                }

                @keyframes senkuro-rgb {
                    0%   { color: #f87171; text-shadow: 0 0 5px #f87171; }
                    25%  { color: #fbbf24; text-shadow: 0 0 5px #fbbf24; }
                    50%  { color: #4ade80; text-shadow: 0 0 5px #4ade80; }
                    75%  { color: #60a5fa; text-shadow: 0 0 5px #60a5fa; }
                    100% { color: #f87171; text-shadow: 0 0 5px #f87171; }
                }
                [data-senkuro-eff="price-effect-rgb"]::after {
                    animation: senkuro-rgb 2.5s linear infinite 0.15s;
                }

                @keyframes senkuro-tilt {
                    0%   { transform: translateZ(0) rotate(-4deg); }
                    100% { transform: translateZ(0) rotate(4deg);  }
                }
                [data-senkuro-eff="price-effect-tilt"]::after {
                    animation: senkuro-tilt 0.8s infinite alternate ease-in-out 0.15s;
                    transform-origin: top center;
                }

                @keyframes senkuro-bg-pulse {
                    0%   { background-color: rgba(0, 0, 0, 0.75); }
                    100% { background-color: rgba(60, 45, 0, 0.9); }
                }
                [data-senkuro-eff="price-effect-bg"]::after {
                    animation: senkuro-bg-pulse 0.8s infinite alternate ease-in-out 0.15s;
                }

                .senkuro-copy-btn {
                    position: absolute;
                    background: rgba(0, 0, 0, 0.6);
                    color: #fff;
                    border-radius: 4px;
                    padding: 4px;
                    cursor: pointer;
                    z-index: 100;
                    pointer-events: auto;
                    transform: translateZ(1px);
                    backface-visibility: hidden;
                    -webkit-backface-visibility: hidden;
                    transition: opacity 0.2s, background 0.2s;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    opacity: 0.3;
                }
                .card-collect-preview__front:hover .senkuro-copy-btn,
                .card-collect-preview:hover .senkuro-copy-btn,
                a.card-collect:hover .senkuro-copy-btn {
                    opacity: 1;
                }
                .senkuro-copy-btn[data-touch="1"] {
                    opacity: 0.75 !important;
                }
                .senkuro-copy-btn:active {
                    background: rgba(99, 102, 241, 0.9);
                    opacity: 1 !important;
                }
            `;
      document.head.appendChild(style);
    }

    const POSITION_MAP = {
      'top-right': { '--s-top': '5px', '--s-right': '5px', '--s-align': 'right' },
      'bottom-right': { '--s-bottom': '5px', '--s-right': '5px', '--s-align': 'right' },
      'center-right': { '--s-top': '50%', '--s-right': '5px', '--s-mt': '-12px', '--s-align': 'right' },
      'top-left': { '--s-top': '5px', '--s-left': '5px', '--s-align': 'left' },
      'bottom-left': { '--s-bottom': '5px', '--s-left': '5px', '--s-align': 'left' },
      'center-left': { '--s-top': '50%', '--s-left': '5px', '--s-mt': '-12px', '--s-align': 'left' },
      center: { '--s-top': '50%', '--s-left': '50%', '--s-ml': '-15px', '--s-mt': '-12px', '--s-align': 'center' },
    };
    const POS_PROPS = ['--s-top', '--s-bottom', '--s-left', '--s-right', '--s-mt', '--s-ml', '--s-align'];

    function applyPosition(el, pos) {
      for (const p of POS_PROPS) el.style.removeProperty(p);
      const vals = POSITION_MAP[pos];
      if (vals) {
        for (const [k, v] of Object.entries(vals)) el.style.setProperty(k, v);
      }
    }

    let _lastOpacity = -1;
    let _cachedBgColor = '';
    let _cachedOutline = '';

    function rebuildOpacityCache() {
      if (_lastOpacity === badgeOpacity) return;
      _lastOpacity = badgeOpacity;
      const op = badgeOpacity / 100;
      _cachedBgColor = `rgba(0,0,0,${op})`;
      _cachedOutline = `1px 1px 0 rgba(0,0,0,${op}),-1px -1px 0 rgba(0,0,0,${op}),1px -1px 0 rgba(0,0,0,${op}),-1px 1px 0 rgba(0,0,0,${op}),0px 2px 4px rgba(0,0,0,${op})`;
    }

    let dbLoadPromise = null;
    async function loadDatabase() {
      if (database !== null) return database;
      if (dbLoadPromise) return dbLoadPromise;

      dbLoadPromise = (async () => {
        try {
          const url = chrome.runtime.getURL('database.json');
          const response = await fetch(url);
          if (!response.ok) throw new Error(`Senkuro DB fetch failed: HTTP ${response.status}`);
          database = await response.json();
        } catch (err) {
          console.error('Senkuro Card Price: Ошибка загрузки database.json', err);
          database = null;
          dbLoadPromise = null;
          return {};
        }
        return database;
      })();

      return dbLoadPromise;
    }

    function updateCommissionSetting() {
      chrome.storage.local.get(
        {
          commission: true,
          copyBtn: true,
          copyBtnSize: 18,
          position: 'top-right',
          opacity: 75,
          badgeStyle: 'background',
          fontSize: 16,
          effectRed: 'price-effect-rgb',
          effectPurple: 'price-effect-tilt',
          effectYellow: 'price-effect-bg',
          effectGreen: 'price-effect-pulse',
          effectWhite: '',
          showToken: false,
        },
        (result) => {
          useCommission = result.commission;
          badgePosition = result.position;
          badgeOpacity = result.opacity;
          badgeStyle = result.badgeStyle;
          badgeFontSize = result.fontSize;
          effectRed = result.effectRed;
          effectPurple = result.effectPurple;
          effectYellow = result.effectYellow;
          effectGreen = result.effectGreen;
          effectWhite = result.effectWhite;
          showCopyBtn = result.copyBtn !== undefined ? result.copyBtn : true;
          copyBtnSize = result.copyBtnSize || 18;
          showToken = result.showToken !== undefined ? result.showToken : false;
          scheduleUpdate();
          updateTokenDisplay();
        }
      );
    }

    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;

      let needsUpdate = false;
      if (changes.commission !== undefined) {
        useCommission = changes.commission.newValue;
        needsUpdate = true;
      }
      if (changes.position !== undefined) {
        badgePosition = changes.position.newValue;
        needsUpdate = true;
      }
      if (changes.opacity !== undefined) {
        badgeOpacity = changes.opacity.newValue;
        needsUpdate = true;
      }
      if (changes.badgeStyle !== undefined) {
        badgeStyle = changes.badgeStyle.newValue;
        needsUpdate = true;
      }
      if (changes.fontSize !== undefined) {
        badgeFontSize = changes.fontSize.newValue;
        needsUpdate = true;
      }
      if (changes.effectRed !== undefined) {
        effectRed = changes.effectRed.newValue;
        needsUpdate = true;
      }
      if (changes.effectPurple !== undefined) {
        effectPurple = changes.effectPurple.newValue;
        needsUpdate = true;
      }
      if (changes.effectYellow !== undefined) {
        effectYellow = changes.effectYellow.newValue;
        needsUpdate = true;
      }
      if (changes.effectGreen !== undefined) {
        effectGreen = changes.effectGreen.newValue;
        needsUpdate = true;
      }
      if (changes.effectWhite !== undefined) {
        effectWhite = changes.effectWhite.newValue;
        needsUpdate = true;
      }
      if (changes.copyBtn !== undefined) {
        showCopyBtn = changes.copyBtn.newValue;
        needsUpdate = true;
      }
      if (changes.copyBtnSize !== undefined) {
        copyBtnSize = changes.copyBtnSize.newValue;
        needsUpdate = true;
      }
      if (changes.showToken !== undefined) {
        showToken = changes.showToken.newValue;
        updateTokenDisplay();
      }

      if (needsUpdate) {
        document.querySelectorAll('[data-senkuro-price]').forEach((el) => {
          el.removeAttribute('data-senkuro-price');
          el.removeAttribute('data-senkuro-style');
          el.removeAttribute('data-senkuro-eff');
        });
        document.querySelectorAll('a.card-collect').forEach((el) => delete el.dataset.priceBadgeAdded);
        scheduleUpdate();
      }
    });

    function extractCharIdFromSrc(src) {
      if (srcCache.has(src)) return srcCache.get(src);

      let result = null;
      try {
        const startIndex = src.indexOf('aHR0cHM');
        if (startIndex !== -1) {
          let base64Part = src.substring(startIndex);
          try {
            base64Part = decodeURIComponent(base64Part);
          } catch (_) {}
          base64Part = base64Part.split('.')[0].split('&')[0];
          while (base64Part.length % 4 !== 0) base64Part += '=';

          const bytes = Uint8Array.from(atob(base64Part), (c) => c.charCodeAt(0));
          const decoded = new TextDecoder('utf-8').decode(bytes);
          const match = decoded.match(/\/characters?\/(\d+)/i);
          if (match && match[1]) {
            result = match[1];
          } else {
            const innerMatch = decoded.match(/\/characters?\/([A-Za-z0-9+/=]+)/i);
            if (innerMatch && innerMatch[1]) {
              const innerRaw = atob(innerMatch[1]);
              let innerText = innerRaw;
              try {
                const innerBytes = Uint8Array.from(innerRaw, (c) => c.charCodeAt(0));
                innerText = new TextDecoder('utf-8').decode(innerBytes);
              } catch (_) {}
              const idMatch = innerText.match(/CHARACTER:(\d+)/i) || innerText.match(/\bID[:\s]+(\d+)/i);
              if (idMatch && idMatch[1]) result = idMatch[1];
            }
          }
        }
      } catch (e) {
        result = null;
      }

      if (srcCache.size > 2000) srcCache.clear();
      srcCache.set(src, result);
      return result;
    }

    async function updatePricesOnPage() {
      const db = await loadDatabase();

      const cards = document.querySelectorAll('a.card-collect');
      if (cards.length === 0) return;

      if (!senkuroLogged) {
        console.log(`[Senkuro Price] Найдено карточек: ${cards.length}`);
        senkuroLogged = true;
      }

      cards.forEach((card) => {
        const img = card.querySelector('img');
        if (!img) return;

        let imgSrc = img.src || '';
        if (imgSrc && imgSrc === document.baseURI) imgSrc = '';
        if (!imgSrc || imgSrc.startsWith('data:')) {
          const srcset = img.getAttribute('srcset') || img.getAttribute('data-srcset') || '';
          if (srcset) imgSrc = (srcset.trim().split(/[,\s]/)[0] || '').trim();
        }

        if (!imgSrc || imgSrc.startsWith('data:')) {
          if (!loadBoundImgs.has(img)) {
            loadBoundImgs.add(img);
            img.addEventListener('load', scheduleUpdate, { once: true });
          }
          return;
        }

        const slug = slugFromHref(card.getAttribute('href'));
        if (!slug) return;

        if (card.dataset.priceBadgeAdded === slug) return;

        if (!db[slug]) return;

        let price = db[slug].price;
        const charName = db[slug].name || 'Неизвестно';
        if (price === undefined || typeof price !== 'number' || !isFinite(price)) return;

        price = effectivePrice(price, useCommission);

        const priceStr = price.toFixed(2);
        const priceNum = +priceStr;

        let priceColor,
          textEffect = '',
          badgeEffect = '';
        const applyEffect = (eff) => {
          if (eff === 'price-effect-bg') badgeEffect = eff;
          else textEffect = eff;
        };

        if (priceNum >= 3.0) {
          priceColor = '#f87171';
          applyEffect(effectRed);
        } else if (priceNum >= 2.4) {
          priceColor = '#fbbf24';
          applyEffect(effectYellow);
        } else if (priceNum >= 2.0) {
          priceColor = '#c084fc';
          applyEffect(effectPurple);
        } else if (priceNum >= 1.6) {
          priceColor = '#4ade80';
          applyEffect(effectGreen);
        } else {
          priceColor = '#ffffff';
          applyEffect(effectWhite);
        }

        const frontEl = card.closest('.card-collect-preview__front');
        const previewEl = frontEl ? null : card.closest('.card-collect-preview');
        const target = frontEl || previewEl || card;

        if (!positionedTargets.has(target)) {
          if (getComputedStyle(target).position === 'static') {
            target.style.position = 'relative';
          }
          positionedTargets.add(target);
        }

        const cardWidth = card.offsetWidth || card.getBoundingClientRect().width;
        const isSmallCard = cardWidth > 0 && cardWidth < 60;

        let finalFontSize = badgeFontSize;
        let finalPadding = '2px 6px';
        if (isSmallCard) {
          finalFontSize = Math.max(9, Math.round(badgeFontSize * Math.max(0.6, cardWidth / 70)));
          finalPadding = '1px 3px';
        }

        const possibleTargets = [card, frontEl, previewEl];
        for (const el of possibleTargets) {
          if (el && el !== target) {
            el.removeAttribute('data-senkuro-price');
            el.removeAttribute('data-senkuro-style');
            el.removeAttribute('data-senkuro-eff');
            el.querySelector('.senkuro-copy-btn')?.remove();
          }
        }

        target.setAttribute('data-senkuro-price', priceStr);
        target.setAttribute('data-senkuro-style', badgeStyle);
        target.setAttribute('data-senkuro-eff', badgeEffect || textEffect || 'none');

        target.style.setProperty('--s-color', priceColor);
        target.style.setProperty('--s-size', `${finalFontSize}px`);
        target.style.setProperty('--s-pad', finalPadding);

        if (badgeStyle === 'background') {
          target.style.setProperty('--s-bg-color', _cachedBgColor);
          target.style.removeProperty('--s-outline');
        } else {
          target.style.setProperty('--s-outline', _cachedOutline);
          target.style.removeProperty('--s-bg-color');
        }

        if (target.dataset.badgePos !== badgePosition) {
          target.dataset.badgePos = badgePosition;
          applyPosition(target, badgePosition);
        }

        if (showCopyBtn && !isSmallCard) {
          let copyBtn = target.querySelector('.senkuro-copy-btn');
          if (!copyBtn) {
            copyBtn = document.createElement('div');
            copyBtn.className = 'senkuro-copy-btn';
            if (isTouchDevice) copyBtn.setAttribute('data-touch', '1');
            target.appendChild(copyBtn);
          }

          const btnSize = copyBtnSize;

          if (copyBtn.dataset.btnSize !== String(btnSize)) {
            copyBtn.dataset.btnSize = String(btnSize);
            copyBtn.style.padding = Math.max(2, Math.round(btnSize / 3.5)) + 'px';

            const svgString = `<svg xmlns="http://www.w3.org/2000/svg" width="${btnSize}" height="${btnSize}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>`;
            const parser = new DOMParser();
            const doc = parser.parseFromString(svgString, 'image/svg+xml');
            copyBtn.replaceChildren(doc.documentElement);
          }

          if (copyBtn.dataset.btnPos !== badgePosition) {
            copyBtn.dataset.btnPos = badgePosition;
            if (badgePosition.includes('right')) {
              copyBtn.style.left = '5px';
              copyBtn.style.right = 'auto';
            } else {
              copyBtn.style.right = '5px';
              copyBtn.style.left = 'auto';
            }
            if (badgePosition.includes('bottom')) {
              copyBtn.style.bottom = '5px';
              copyBtn.style.top = 'auto';
            } else {
              copyBtn.style.top = '5px';
              copyBtn.style.bottom = 'auto';
            }
          }

          if (copyBtn.dataset.charName !== charName) {
            copyBtn.dataset.charName = charName;
            copyBtn.title = 'Копировать имя: ' + charName;
            const doCopy = (e) => {
              e.preventDefault();
              e.stopPropagation();
              const btnSz = copyBtnSize;
              navigator.clipboard
                .writeText(charName)
                .then(() => {
                  const oldChild = copyBtn.firstElementChild ? copyBtn.firstElementChild.cloneNode(true) : null;
                  copyBtn.dataset.btnSize = '';

                  const successSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${btnSz}" height="${btnSz}" viewBox="0 0 24 24" fill="none" stroke="#4ade80" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
                  const parser = new DOMParser();
                  const doc = parser.parseFromString(successSvg, 'image/svg+xml');
                  copyBtn.replaceChildren(doc.documentElement);

                  setTimeout(() => {
                    if (copyBtn && oldChild) {
                      copyBtn.replaceChildren(oldChild);
                      copyBtn.dataset.btnSize = String(btnSz);
                    }
                  }, 1500);
                })
                .catch((err) => console.warn('[Senkuro] Clipboard write failed:', err));
            };
            copyBtn.onclick = doCopy;
            if (isTouchDevice) copyBtn.ontouchend = doCopy;
          }
        } else {
          target.querySelector('.senkuro-copy-btn')?.remove();
        }

        card.dataset.priceBadgeAdded = slug;
      });
    }

    async function updateTokenDisplay() {
      console.log('[Senkuro Token] updateTokenDisplay вызван, showToken =', showToken);
      document.getElementById('senkuro-token-badge')?.remove();
      if (!showToken) {
        console.log('[Senkuro Token] showToken=false — выходим');
        return;
      }

      let token = null;

      try {
        const m = document.cookie.match(/(?:^|;\s*)access_token=([^;]+)/);
        if (m) token = decodeURIComponent(m[1]);
        console.log('[Senkuro Token] document.cookie:', token ? 'найден (' + token.substring(0, 20) + '...)' : 'не найден');
      } catch (e) {
        console.warn('[Senkuro Token] document.cookie ошибка:', e);
      }

      if (!token) {
        console.log('[Senkuro Token] Пробуем background.js...');
        try {
          token = await new Promise((resolve) => {
            chrome.runtime.sendMessage({ type: 'SENKURO_GET_TOKEN' }, (res) => {
              if (chrome.runtime.lastError) {
                console.warn('[Senkuro Token] sendMessage ошибка:', chrome.runtime.lastError.message);
                resolve(null);
                return;
              }
              console.log('[Senkuro Token] background ответил:', res);
              resolve(res?.token || null);
            });
          });
        } catch (e) {
          console.warn('[Senkuro Token] Promise ошибка:', e);
        }
      }

      console.log('[Senkuro Token] итог: token =', token ? token.substring(0, 30) + '...' : null);
      injectTokenBadge(token);
    }

    function injectTokenBadge(token) {
      document.getElementById('senkuro-token-badge')?.remove();
      if (!showToken) return;

      const badge = document.createElement('div');
      badge.id = 'senkuro-token-badge';

      Object.assign(badge.style, {
        position: 'fixed',
        bottom: '0',
        left: '0',
        right: '0',
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        padding: '8px 20px',
        background: 'rgba(10, 10, 20, 0.95)',
        borderTop: '1px solid rgba(99, 102, 241, 0.4)',
        fontFamily: "'Inter', sans-serif",
        fontSize: '12px',
        color: '#94a3b8',
        zIndex: '999999',
        boxSizing: 'border-box',
        backdropFilter: 'blur(8px)',
      });

      const label = document.createElement('span');
      label.textContent = '\uD83D\uDD11 Токен аккаунта:';
      label.style.cssText = 'color:#818cf8; font-weight:600; white-space:nowrap;';

      const statusSpan = document.createElement('span');
      if (token) {
        statusSpan.textContent = 'обнаружен \u2713';
        statusSpan.style.cssText = 'color:#4ade80; font-weight:600;';
      } else {
        statusSpan.textContent = 'не найден — войдите в аккаунт';
        statusSpan.style.cssText = 'color:#f87171;';
      }

      badge.appendChild(label);
      badge.appendChild(statusSpan);

      if (token) {
        const copyBtn = document.createElement('button');
        copyBtn.textContent = 'Копировать токен';
        Object.assign(copyBtn.style, {
          padding: '3px 12px',
          background: '#1e293b',
          border: '1px solid #475569',
          borderRadius: '4px',
          color: '#e2e8f0',
          cursor: 'pointer',
          fontSize: '11px',
          fontWeight: '600',
          fontFamily: "'Inter', sans-serif",
          whiteSpace: 'nowrap',
          transition: 'background 0.2s, color 0.2s, border-color 0.2s',
        });

        copyBtn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          navigator.clipboard
            .writeText(token)
            .then(() => {
              copyBtn.textContent = '\u2713 Скопировано!';
              copyBtn.style.background = 'rgba(74,222,128,0.15)';
              copyBtn.style.borderColor = '#4ade80';
              copyBtn.style.color = '#4ade80';
              setTimeout(() => {
                copyBtn.textContent = 'Копировать токен';
                copyBtn.style.background = '#1e293b';
                copyBtn.style.borderColor = '#475569';
                copyBtn.style.color = '#e2e8f0';
              }, 2500);
            })
            .catch(() => {
              prompt('Скопируй токен вручную (Ctrl+A, Ctrl+C):', token);
            });
        });

        badge.appendChild(copyBtn);
      }

      document.body.appendChild(badge);
    }

    let updateScheduled = false;
    function scheduleUpdate() {
      if (updateScheduled) return;
      updateScheduled = true;

      const run = async () => {
        updateScheduled = false;
        _isRendering = true;
        try {
          rebuildOpacityCache();
          await updatePricesOnPage();
          updateTradeSummaries(await loadDatabase(), { commission: useCommission }, tradeStore);
        } finally {
          _isRendering = false;
        }
      };

      if (!isTouchDevice && typeof requestIdleCallback !== 'undefined') {
        requestIdleCallback(run, { timeout: 500 });
      } else {
        setTimeout(run, 0);
      }
    }

    let debounceTimer = null;
    const DEBOUNCE_MS = 250;

    const observer = new MutationObserver((mutations) => {
      if (_isRendering) return;
      let relevant = false;
      for (const m of mutations) {
        if (m.addedNodes.length > 0 || m.type === 'attributes' || isTradeMutation(m)) {
          relevant = true;
          break;
        }
      }
      if (!relevant) return;

      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(scheduleUpdate, DEBOUNCE_MS);
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['src', 'srcset', 'data-srcset'],
    });

    function onNavigate() {
      if (location.pathname === _lastPathname) return;
      _lastPathname = location.pathname;
      srcCache.clear();
      senkuroLogged = false;
      document.querySelectorAll('[data-senkuro-price]').forEach((el) => {
        el.removeAttribute('data-senkuro-price');
        el.removeAttribute('data-senkuro-style');
        el.removeAttribute('data-senkuro-eff');
        el.removeAttribute('data-badge-pos');
      });
      document.querySelectorAll('.senkuro-copy-btn').forEach((el) => el.remove());
      document.querySelectorAll('a.card-collect').forEach((el) => delete el.dataset.priceBadgeAdded);
      scheduleUpdate();
      document.getElementById('senkuro-token-badge')?.remove();
      if (showToken) setTimeout(updateTokenDisplay, 800);
    }

    if (!history.pushState._senkuroPatched) {
      const _origPushState = history.pushState.bind(history);
      history.pushState = function (...args) {
        _origPushState(...args);
        onNavigate();
      };
      history.pushState._senkuroPatched = true;
    }
    if (window._senkuroNavHandler) {
      window.removeEventListener('popstate', window._senkuroNavHandler);
    }
    window._senkuroNavHandler = onNavigate;
    window.addEventListener('popstate', onNavigate);

    function _init() {
      listenForTrades(tradeStore, scheduleUpdate);
      updateCommissionSetting();
      setTimeout(scheduleUpdate, 1500);
      setTimeout(scheduleUpdate, 4000);
      setTimeout(updateTokenDisplay, 600);
    }

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', _init);
    } else {
      _init();
    }
  },
});
