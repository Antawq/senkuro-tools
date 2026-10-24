import { element } from './dom';
import { refreshIcon } from './svg';

const SITE_BUTTON = 'button button--secondary button--icon button-size--md';
const ICON_SIZE_PX = 20;

export function createRefreshButton(press: () => Promise<boolean>, className?: string): HTMLButtonElement {
  const button = element('button', className ? `${SITE_BUTTON} ${className}` : SITE_BUTTON);
  button.type = 'button';
  const icon = refreshIcon(ICON_SIZE_PX);
  icon.setAttribute('aria-hidden', 'true');
  button.append(icon);
  button.addEventListener('click', () => {
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    void press().then((isReusable) => {
      if (!isReusable) return;
      button.disabled = false;
      button.removeAttribute('aria-busy');
    });
  });
  return button;
}
