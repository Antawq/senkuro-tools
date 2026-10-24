import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { RefreshOutcome } from '../utils/shared/refresh-signal';
import { MODAL_REFRESH_CLASS, createModalRefreshWatcher, isModalMutation, syncModalRefreshButtons, type ModalRefreshHost } from '../utils/trades/modal-refresh';

const HINT = ' Выбери до 50 карт, которые готов отдать взамен';

const modalHtml = ({
  title = 'Твои карточки',
  hint = HINT,
  hasList = true,
  extra = '',
}: { title?: string; hint?: string; hasList?: boolean; extra?: string } = {}) => `
  <div class="modal-content modal-content--trade">
    <header class="modal-trade__header">
      <div class="modal-trade__header-headline"><h4 class="caption">${title}</h4><div class="modal-trade__header-hint">${hint}</div></div>
      ${extra}<button class="button button--secondary button--icon button-size--md" type="button" id="close"><svg></svg></button>
    </header>
    <div class="modal-trade__body">${hasList ? '<div class="modal-trade__body-result"><div class="card-collect-preview"></div></div>' : ''}</div>
  </div>`;

const findButton = () => document.querySelector<HTMLButtonElement>(`.${MODAL_REFRESH_CLASS}`);
const findClose = () => document.getElementById('close') as HTMLElement;
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

interface Rig {
  host: ModalRefreshHost;
  frames: (() => void)[];
  answer: (outcome: RefreshOutcome) => void;
  setReady: (isReady: boolean) => void;
}

const createRig = (): Rig => {
  let isReady = true;
  let answer: (outcome: RefreshOutcome) => void = () => undefined;
  const frames: (() => void)[] = [];
  const host: ModalRefreshHost = {
    isReady: () => isReady,
    refresh: vi.fn(
      () =>
        new Promise<RefreshOutcome>((resolve) => {
          answer = resolve;
        })
    ),
    nextFrame: (run) => void frames.push(run),
  };
  return { host, frames, answer: (outcome) => answer(outcome), setReady: (next) => (isReady = next) };
};

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('syncModalRefreshButtons', () => {
  it('puts an icon button right before the close button of a window that lists cards, built from the site button classes', () => {
    document.body.innerHTML = modalHtml();
    syncModalRefreshButtons(createRig().host);
    const added = findButton();
    expect(added).not.toBeNull();
    expect(added?.nextElementSibling).toBe(findClose());
    expect(added?.className).toBe(`button button--secondary button--icon button-size--md ${MODAL_REFRESH_CLASS}`);
    expect(added?.type).toBe('button');
    expect(added?.getAttribute('aria-label')).toBe('Обновить список карт');
    expect(added?.title).toBe('Обновить список карт');
    expect(added?.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('adds nothing to the header but the button, so the texts the other modules read stay the same', () => {
    document.body.innerHTML = modalHtml();
    const header = document.querySelector('.modal-trade__header') as HTMLElement;
    const before = header.textContent;
    syncModalRefreshButtons(createRig().host);
    expect(header.textContent).toBe(before);
    expect([...header.children].map((child) => child.tagName)).toEqual(['DIV', 'BUTTON', 'BUTTON']);
  });

  it('is there once however often it runs', () => {
    document.body.innerHTML = modalHtml();
    const { host } = createRig();
    syncModalRefreshButtons(host);
    const first = findButton();
    syncModalRefreshButtons(host);
    syncModalRefreshButtons(host);
    expect(document.querySelectorAll(`.${MODAL_REFRESH_CLASS}`)).toHaveLength(1);
    expect(findButton()).toBe(first);
  });

  it('puts the button back before the close button when something moved it', () => {
    document.body.innerHTML = modalHtml();
    const { host } = createRig();
    syncModalRefreshButtons(host);
    const header = document.querySelector('.modal-trade__header') as HTMLElement;
    const own = findButton() as HTMLElement;
    header.prepend(own);
    syncModalRefreshButtons(host);
    expect(findButton()).toBe(own);
    expect(own.nextElementSibling).toBe(findClose());
  });

  it('is made again after the site drew the header anew', () => {
    document.body.innerHTML = modalHtml();
    const { host } = createRig();
    syncModalRefreshButtons(host);
    document.body.innerHTML = modalHtml();
    expect(findButton()).toBeNull();
    syncModalRefreshButtons(host);
    expect(document.querySelectorAll(`.${MODAL_REFRESH_CLASS}`)).toHaveLength(1);
  });

  it('is not in the step that lists the catalog, and is taken away when the window turns into it', () => {
    document.body.innerHTML = modalHtml({ title: 'Выбор карт из общего каталога' });
    const { host } = createRig();
    syncModalRefreshButtons(host);
    expect(findButton()).toBeNull();
    document.body.innerHTML = modalHtml();
    syncModalRefreshButtons(host);
    expect(findButton()).not.toBeNull();
    (document.querySelector('.modal-trade__header h4') as HTMLElement).textContent = 'Выбор карт из общего каталога';
    syncModalRefreshButtons(host);
    expect(findButton()).toBeNull();
  });

  it('is not in a window that draws no list, nor in one with no close button to stand before', () => {
    const { host } = createRig();
    document.body.innerHTML = modalHtml({ hasList: false });
    syncModalRefreshButtons(host);
    expect(findButton()).toBeNull();
    document.body.innerHTML = modalHtml();
    findClose().remove();
    syncModalRefreshButtons(host);
    expect(findButton()).toBeNull();
  });

  it('waits for the page guard, and goes if the guard is not ready any more', () => {
    document.body.innerHTML = modalHtml();
    const { host, setReady } = createRig();
    setReady(false);
    syncModalRefreshButtons(host);
    expect(findButton()).toBeNull();
    setReady(true);
    syncModalRefreshButtons(host);
    expect(findButton()).not.toBeNull();
    setReady(false);
    syncModalRefreshButtons(host);
    expect(findButton()).toBeNull();
  });

  it('puts a button into every window of the page and ignores a page with none', () => {
    const { host } = createRig();
    syncModalRefreshButtons(host);
    document.body.innerHTML = modalHtml() + modalHtml({ title: 'Выбор карточек' });
    syncModalRefreshButtons(host);
    expect(document.querySelectorAll(`.${MODAL_REFRESH_CLASS}`)).toHaveLength(2);
  });
});

describe('pressing the button', () => {
  const press = () => {
    document.body.innerHTML = modalHtml();
    const rig = createRig();
    syncModalRefreshButtons(rig.host);
    findButton()?.click();
    return rig;
  };

  it('asks the page to refresh the lists of the window and keeps the button busy until it has answered', async () => {
    const { host, answer } = press();
    expect(host.refresh).toHaveBeenCalledTimes(1);
    expect(findButton()?.disabled).toBe(true);
    expect(findButton()?.getAttribute('aria-busy')).toBe('true');
    answer('done');
    await settle();
    expect(findButton()?.disabled).toBe(false);
    expect(findButton()?.hasAttribute('aria-busy')).toBe(false);
  });

  it('gives the button back whatever the answer was, and never reloads the page, which would drop the selection', async () => {
    for (const outcome of ['nothing', 'failed'] as const) {
      const { answer } = press();
      answer(outcome);
      await settle();
      expect(findButton()?.disabled).toBe(false);
    }
  });

  it('runs once however many times it is pressed', async () => {
    const { host, answer } = press();
    const pressed = findButton();
    pressed?.click();
    pressed?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    answer('done');
    await settle();
    expect(host.refresh).toHaveBeenCalledTimes(1);
  });

  it('stays busy through the sync the page makes while it works', () => {
    const { host } = press();
    syncModalRefreshButtons(host);
    expect(findButton()?.disabled).toBe(true);
  });
});

describe('isModalMutation', () => {
  const record = (target: Node, addedNodes: Node[] = [], removedNodes: Node[] = []) => ({ target, addedNodes, removedNodes }) as unknown as MutationRecord;

  it('is true for rows added to the list of a window, and for a window that was just added', () => {
    document.body.innerHTML = modalHtml();
    const list = document.querySelector('.modal-trade__body-result') as Element;
    expect(isModalMutation(record(list, [document.createElement('div')]))).toBe(true);
    expect(isModalMutation(record(document.body, [document.querySelector('.modal-content--trade') as Element]))).toBe(true);
  });

  it('is true for the title of the window changing, as when the offer window goes from one step to the next', () => {
    document.body.innerHTML = modalHtml();
    const title = (document.querySelector('.modal-trade__header h4') as HTMLElement).firstChild as Text;
    expect(isModalMutation(record(title))).toBe(true);
  });

  it('is false for the button itself being added or removed', () => {
    document.body.innerHTML = modalHtml();
    syncModalRefreshButtons(createRig().host);
    const own = findButton() as Element;
    const header = document.querySelector('.modal-trade__header') as Element;
    expect(isModalMutation(record(header, [own]))).toBe(false);
    expect(isModalMutation(record(header, [], [own]))).toBe(false);
    expect(isModalMutation(record(own, [document.createElement('span')]))).toBe(false);
  });

  it('is false for a change outside every window', () => {
    document.body.innerHTML = modalHtml() + '<div class="elsewhere"></div>';
    expect(isModalMutation(record(document.querySelector('.elsewhere') as Element, [document.createElement('div')]))).toBe(false);
  });
});

describe('createModalRefreshWatcher', () => {
  const insideWindow = () => {
    document.body.innerHTML = modalHtml();
    return {
      target: document.querySelector('.modal-trade__body-result') as Node,
      addedNodes: [document.createElement('div')],
      removedNodes: [],
    } as unknown as MutationRecord;
  };

  it('syncs the buttons in the next frame, once for a burst of changes', () => {
    const { host, frames } = createRig();
    const watcher = createModalRefreshWatcher(host);
    const change = insideWindow();
    watcher.watch([change, change]);
    watcher.watch([change]);
    expect(frames).toHaveLength(1);
    expect(findButton()).toBeNull();
    frames[0]?.();
    expect(findButton()).not.toBeNull();
    watcher.watch([change]);
    expect(frames).toHaveLength(2);
  });

  it('does nothing for changes that are not in a window, nor for the button it added itself', () => {
    const { host, frames } = createRig();
    const watcher = createModalRefreshWatcher(host);
    insideWindow();
    syncModalRefreshButtons(host);
    const header = document.querySelector('.modal-trade__header') as Node;
    const own = findButton() as Node;
    watcher.watch([{ target: header, addedNodes: [own], removedNodes: [] } as unknown as MutationRecord]);
    watcher.watch([{ target: document.body, addedNodes: [document.createElement('p')], removedNodes: [] } as unknown as MutationRecord]);
    expect(frames).toHaveLength(0);
  });
});
