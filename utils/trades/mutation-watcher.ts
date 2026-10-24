const isOwnNode = (node: Node, ownSelector: string): boolean => node instanceof Element && node.matches(ownSelector);

const hasPlace = (node: Node, placeSelector: string): boolean =>
  node instanceof Element && (node.matches(placeSelector) || node.querySelector(placeSelector) !== null);

export const createMutationFilter =
  (placeSelector: string, ownSelector: string) =>
  (mutation: MutationRecord): boolean => {
    const changed = [...mutation.addedNodes, ...mutation.removedNodes];
    if (changed.length > 0 && changed.every((node) => isOwnNode(node, ownSelector))) return false;
    const target = mutation.target instanceof Element ? mutation.target : mutation.target.parentElement;
    if (target?.closest(ownSelector)) return false;
    return Boolean(target?.closest(placeSelector)) || [...mutation.addedNodes].some((node) => hasPlace(node, placeSelector));
  };

export function createFrameWatcher(isRelevant: (mutation: MutationRecord) => boolean, sync: () => void, nextFrame: (run: () => void) => void) {
  let isScheduled = false;
  return {
    watch(mutations: Iterable<MutationRecord>) {
      if (isScheduled || ![...mutations].some(isRelevant)) return;
      isScheduled = true;
      nextFrame(() => {
        isScheduled = false;
        sync();
      });
    },
  };
}
