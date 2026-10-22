import { browser } from 'wxt/browser';
import type { ContentScriptContext } from 'wxt/utils/content-script-context';
import { createIntegratedUi, type IntegratedContentScriptUi } from 'wxt/utils/content-script-ui/integrated';

import { element } from '../shared/dom';
import { readDocumentToken } from './access-token';
import { TOKEN_REQUEST, type TokenRequest, type TokenResponse } from './messages';

const BAR = 'senkuro-token-bar';
const COPIED_MS = 2500;
const COPY_LABEL = 'Копировать токен';
const COPIED_LABEL = '✓ Скопировано!';
const MANUAL_COPY_PROMPT = 'Скопируй токен вручную (Ctrl+A, Ctrl+C):';
const COPIED = `${BAR}__copy--done`;

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

function copyButton(token: string): HTMLButtonElement {
  const button = element('button', `${BAR}__copy`, COPY_LABEL);
  button.type = 'button';
  button.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    navigator.clipboard.writeText(token).then(
      () => {
        button.textContent = COPIED_LABEL;
        button.classList.add(COPIED);
        setTimeout(() => {
          button.textContent = COPY_LABEL;
          button.classList.remove(COPIED);
        }, COPIED_MS);
      },
      () => prompt(MANUAL_COPY_PROMPT, token)
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
