import { CARD_LINK } from './cards';
import type { Database } from './database';

export interface RenderSteps {
  cards(db: Database, cards?: HTMLAnchorElement[]): void;
  trades(db: Database): void;
  profile(db: Database): void;
  sort(db: Database): void;
}

export interface RenderLoop {
  addCards: (cards: Iterable<HTMLAnchorElement>) => void;
  markTrades: () => void;
  schedule: () => void;
  renderAll: () => Promise<void>;
}

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

export function createRenderLoop(steps: RenderSteps, loadDatabase: () => Promise<Database>, nextFrame: (run: () => void) => void): RenderLoop {
  const queue = new Set<HTMLAnchorElement>();
  let tradesDirty = false;
  let scheduled = false;

  const takePending = () => {
    const pending = { cards: [...queue], trades: tradesDirty };
    queue.clear();
    tradesDirty = false;
    return pending;
  };

  async function flush(): Promise<void> {
    scheduled = false;
    const { cards, trades } = takePending();
    try {
      const db = await loadDatabase();
      if (cards.length > 0) steps.cards(db, cards);
      if (trades) steps.trades(db);
      steps.profile(db);
      steps.sort(db);
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
        const db = await loadDatabase();
        steps.cards(db);
        steps.trades(db);
        steps.profile(db);
        steps.sort(db);
      } catch (error) {
        console.error('SenkuTools: render error', error);
      }
    },
  };
}
