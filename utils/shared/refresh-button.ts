import { element } from './dom';
import { refreshIcon } from './svg';

const SITE_BUTTON = 'button button--secondary button--icon button-size--md';
const SITE_DISABLED = 'button--disabled';
const ICON_SIZE_PX = 20;

export function createRefreshButton(press: () => Promise<boolean>, className?: string): HTMLButtonElement {
  const button = element('button', className ? `${SITE_BUTTON} ${className}` : SITE_BUTTON);
  button.type = 'button';
  const icon = refreshIcon(ICON_SIZE_PX);
  icon.setAttribute('aria-hidden', 'true');
  button.append(icon);
  button.addEventListener('click', () => {
    if (button.hasAttribute('aria-disabled')) return;
    button.setAttribute('aria-disabled', 'true');
    button.setAttribute('aria-busy', 'true');
    button.classList.add(SITE_DISABLED);
    void press().then((isReusable) => {
      if (!isReusable) return;
      button.removeAttribute('aria-disabled');
      button.removeAttribute('aria-busy');
      button.classList.remove(SITE_DISABLED);
    });
  });
  return button;
}
