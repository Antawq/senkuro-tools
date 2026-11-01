import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { closeToolbarPanels, createPanelShell, setPanelOpen, VIEWPORT_MARGIN_PX } from '../utils/shared/toolbar-panel';

const control = (id: string) => {
  const host = document.createElement('div');
  host.id = id;
  const trigger = document.createElement('button');
  trigger.setAttribute('aria-expanded', 'false');
  const menu = document.createElement('div');
  menu.className = 'dropdown-menu';
  const panel = createPanelShell('senkutools-test__panel', menu);
  host.append(trigger, panel);
  document.body.append(host);
  return { host, trigger, panel };
};

beforeEach(() => {
  document.body.innerHTML = '';
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('createPanelShell', () => {
  it('wraps the menu the way the site wraps a dropdown, hidden, with its own class and the shared one', () => {
    const { panel } = control('a');
    expect(panel.className).toBe('senkutools-test__panel senkutools-toolbar-panel v-popper--theme-dropdown');
    expect(panel.hidden).toBe(true);
    expect(panel.querySelector(':scope > .v-popper__wrapper > .v-popper__inner > .dropdown-menu')).not.toBeNull();
  });
});

describe('setPanelOpen', () => {
  it('shows or hides the panel together with aria-expanded of its trigger', () => {
    const { trigger, panel } = control('a');
    setPanelOpen(panel, trigger, true);
    expect([panel.hidden, trigger.getAttribute('aria-expanded')]).toEqual([false, 'true']);
    setPanelOpen(panel, trigger, false);
    expect([panel.hidden, trigger.getAttribute('aria-expanded')]).toEqual([true, 'false']);
  });

  it('keeps an open panel inside the right margin of the viewport and leaves a closed one alone', () => {
    const { trigger, panel } = control('a');
    vi.spyOn(document.documentElement, 'clientWidth', 'get').mockReturnValue(360);
    vi.spyOn(panel, 'getBoundingClientRect').mockReturnValue({ left: 200, right: 360 - VIEWPORT_MARGIN_PX + 30 } as DOMRect);
    setPanelOpen(panel, trigger, true);
    expect(panel.style.left).toBe('-30px');
    setPanelOpen(panel, trigger, false);
    expect(panel.style.left).toBe('-30px');
  });
});

describe('closeToolbarPanels', () => {
  it('closes every open panel except the one that holds the target, whatever control made it', () => {
    const first = control('first');
    const second = control('second');
    setPanelOpen(first.panel, first.trigger, true);
    setPanelOpen(second.panel, second.trigger, true);
    closeToolbarPanels(document, first.trigger);
    expect([first.panel.hidden, second.panel.hidden]).toEqual([false, true]);
    expect(second.trigger.getAttribute('aria-expanded')).toBe('false');
    closeToolbarPanels(document, document.body);
    expect(first.panel.hidden).toBe(true);
  });

  it('closes everything when the target is not a node', () => {
    const { trigger, panel } = control('a');
    setPanelOpen(panel, trigger, true);
    closeToolbarPanels(document, null);
    expect(panel.hidden).toBe(true);
  });
});
