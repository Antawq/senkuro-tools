import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createToolbarControls } from '../utils/shared/toolbar-controls';

const toolbarWith = (id: string, html = '') => {
  const toolbar = document.createElement('div');
  toolbar.id = id;
  toolbar.innerHTML = html;
  document.body.append(toolbar);
  return toolbar;
};

const create = () => ({ wrapper: document.createElement('div') });

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('createToolbarControls', () => {
  it('creates a control once per toolbar and hands the same one back afterwards', () => {
    const controls = createToolbarControls<ReturnType<typeof create>>();
    const make = vi.fn(create);
    const toolbar = toolbarWith('a');
    const first = controls.place(toolbar, make, []);
    expect(controls.place(toolbar, make, [])).toBe(first);
    expect(make).toHaveBeenCalledOnce();
  });

  it('keeps one control per toolbar', () => {
    const controls = createToolbarControls<ReturnType<typeof create>>();
    expect(controls.place(toolbarWith('a'), create, [])).not.toBe(controls.place(toolbarWith('b'), create, []));
  });

  it('puts the wrapper last, or before the first of the later controls, and leaves it there on the next call', () => {
    const controls = createToolbarControls<ReturnType<typeof create>>();
    const plain = toolbarWith('a', '<i></i>');
    const control = controls.place(plain, create, ['.later']);
    expect(plain.lastElementChild).toBe(control.wrapper);
    const crowded = toolbarWith('b', '<i></i><s class="later"></s>');
    const other = controls.place(crowded, create, ['.later']);
    expect(other.wrapper.nextElementSibling?.className).toBe('later');
    const observer = new MutationObserver(() => undefined);
    observer.observe(crowded, { childList: true });
    controls.place(crowded, create, ['.later']);
    expect(observer.takeRecords()).toEqual([]);
    observer.disconnect();
  });

  it('takes the wrapper out of the page and forgets the control, so the next place makes a new one', () => {
    const controls = createToolbarControls<ReturnType<typeof create>>();
    const toolbar = toolbarWith('a');
    const first = controls.place(toolbar, create, []);
    controls.remove(toolbar);
    expect(first.wrapper.isConnected).toBe(false);
    expect(controls.place(toolbar, create, [])).not.toBe(first);
  });

  it('removes nothing from a toolbar that has no control', () => {
    const controls = createToolbarControls<ReturnType<typeof create>>();
    expect(() => controls.remove(toolbarWith('a'))).not.toThrow();
  });
});
