import { CARD_LINK } from './cards';
import type { Database } from './database';

export type RenderTrigger = 'cards' | 'trades';

export interface RenderStep {
  name: string;
  trigger?: RenderTrigger;
  render: (db: Database, cards?: HTMLAnchorElement[]) => void;
}

export interface RenderLoop {
  addCards: (cards: Iterable<HTMLAnchorElement>) => void;
  markTrades: () => void;
  schedule: () => void;
  renderAll: () => Promise<void>;
}

interface Pending {
  cards: HTMLAnchorElement[];
  hasTradeChange: boolean;
}

type RenderArguments = Parameters<RenderStep['render']>;

export function addedCards(mutations: Iterable<MutationRecord>): HTMLAnchorElement[] {
  const cards: HTMLAnchorElement[] = [];
  for (const { addedNodes } of mutations) {
    for (const node of addedNodes) {
      if (!(node instanceof HTMLElement)) continue;
      if (node.matches(CARD_LINK)) cards.push(node as HTMLAnchorElement);
      cards.push(...node.querySelectorAll<HTMLAnchorElement>(CARD_LINK));
    }
  }
  return cards;
}

function runStep(step: RenderStep, renderArguments: RenderArguments): void {
  try {
    step.render(...renderArguments);
  } catch (error) {
    console.error(`SenkuTools: render step ${step.name} failed`, error);
  }
}

function frameArgumentsOf(step: RenderStep, db: Database, pending: Pending): RenderArguments | null {
  if (step.trigger === 'cards') return pending.cards.length > 0 ? [db, pending.cards] : null;
  if (step.trigger === 'trades') return pending.hasTradeChange ? [db] : null;
  return [db];
}

function renderFrame(steps: readonly RenderStep[], db: Database, pending: Pending): void {
  for (const step of steps) {
    const renderArguments = frameArgumentsOf(step, db, pending);
    if (renderArguments) runStep(step, renderArguments);
  }
}

function renderEveryStep(steps: readonly RenderStep[], db: Database): void {
  for (const step of steps) runStep(step, [db]);
}

export function createRenderLoop(steps: readonly RenderStep[], loadDatabase: () => Promise<Database>, nextFrame: (run: () => void) => void): RenderLoop {
  const queue = new Set<HTMLAnchorElement>();
  let tradesDirty = false;
  let scheduled = false;

  const takePending = (): Pending => {
    const pending = { cards: [...queue], hasTradeChange: tradesDirty };
    queue.clear();
    tradesDirty = false;
    return pending;
  };

  async function flush(): Promise<void> {
    scheduled = false;
    const pending = takePending();
    try {
      renderFrame(steps, await loadDatabase(), pending);
    } catch (error) {
      console.error('SenkuTools: batch render error', error);
    }
  }

  return {
    addCards: (cards) => {
      for (const card of cards) queue.add(card);
    },
    markTrades: () => {
      tradesDirty = true;
    },
    schedule: () => {
      if (scheduled) return;
      scheduled = true;
      nextFrame(() => void flush());
    },
    renderAll: async () => {
      takePending();
      try {
        renderEveryStep(steps, await loadDatabase());
      } catch (error) {
        console.error('SenkuTools: render error', error);
      }
    },
  };
}
