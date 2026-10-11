import { browser } from 'wxt/browser';
import type { ContentScriptContext } from 'wxt/utils/content-script-context';
import { createIntegratedUi, type IntegratedContentScriptUi } from 'wxt/utils/content-script-ui/integrated';

import { readDocumentToken } from './access-token';
import { TOKEN_REQUEST, type TokenRequest, type TokenResponse } from './messages';

const BAR = 'senkuro-token-bar';
const COPIED_MS = 2500;
const COPY_LABEL = 'Копировать токен';

export interface TokenBar {
  sync(visible: boolean): Promise<void>;
}

async function readToken(): Promise<string | null> {
  const own = readDocumentToken();
  if (own) return own;
  try {
    const request: TokenRequest = { type: TOKEN_REQUEST };
    const response = await browser.runtime.sendMessage<TokenRequest, TokenResponse | undefined>(request);
    return response?.token ?? null;
  } catch {
    return null;
  }
}

const element = <K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text: string): HTMLElementTagNameMap[K] => {
  const el = document.createElement(tag);
  el.className = className;
  el.textContent = text;
  return el;
};

function copyButton(token: string): HTMLButtonElement {
  const button = element('button', `${BAR}__copy`, COPY_LABEL);
  button.type = 'button';
  button.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    navigator.clipboard.writeText(token).then(
      () => {
        button.textContent = '✓ Скопировано!';
        button.classList.add(`${BAR}__copy--done`);
        setTimeout(() => {
          button.textContent = COPY_LABEL;
          button.classList.remove(`${BAR}__copy--done`);
        }, COPIED_MS);
      },
      () => prompt('Скопируй токен вручную (Ctrl+A, Ctrl+C):', token)
    );
  });
  return button;
}

function bar(token: string | null): HTMLElement {
  const root = element('div', BAR, '');
  root.append(
    element('span', `${BAR}__label`, 'Токен аккаунта:'),
    token ? element('span', `${BAR}__found`, 'обнаружен ✓') : element('span', `${BAR}__missing`, 'не найден: войдите в аккаунт')
  );
  if (token) root.append(copyButton(token));
  return root;
}

export function createTokenBar(ctx: ContentScriptContext): TokenBar {
  let ui: IntegratedContentScriptUi<void> | null = null;
  const hide = () => {
    ui?.remove();
    ui = null;
  };
  return {
    async sync(visible) {
      if (!visible) {
        hide();
        return;
      }
      const token = await readToken();
      if (ctx.isInvalid) return;
      hide();
      ui = createIntegratedUi(ctx, { position: 'inline', anchor: 'body', onMount: (wrapper) => wrapper.append(bar(token)) });
      ui.mount();
    },
  };
}
