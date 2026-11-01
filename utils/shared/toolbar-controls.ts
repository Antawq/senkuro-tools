import { placeBeforeAny } from './dom';

export interface ToolbarControl {
  wrapper: HTMLElement;
}

export interface ToolbarControls<Control extends ToolbarControl> {
  place: (toolbar: Element, create: () => Control, laterSelectors: readonly string[]) => Control;
  remove: (toolbar: Element) => void;
}

export function createToolbarControls<Control extends ToolbarControl>(): ToolbarControls<Control> {
  const controls = new WeakMap<Element, Control>();
  return {
    place(toolbar, create, laterSelectors) {
      const control = controls.get(toolbar) ?? create();
      controls.set(toolbar, control);
      placeBeforeAny(toolbar, control.wrapper, laterSelectors);
      return control;
    },
    remove(toolbar) {
      controls.get(toolbar)?.wrapper.remove();
      controls.delete(toolbar);
    },
  };
}
