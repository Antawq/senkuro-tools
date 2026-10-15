import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Database } from '../utils/database';
import { addedCards, createRenderLoop, type RenderSteps } from '../utils/render-loop';

const db: Database = {};

const link = (slug: string): HTMLAnchorElement => {
  const a = document.createElement('a');
  a.className = 'card-collect';
  a.href = `/cards/${slug}`;
  return a;
};

const setup = (load: () => Promise<Database> = () => Promise.resolve(db)) => {
  const steps = { cards: vi.fn<RenderSteps['cards']>(), trades: vi.fn<RenderSteps['trades']>(), profile: vi.fn<RenderSteps['profile']>() };
  const frames: (() => void)[] = [];
  const loop = createRenderLoop(steps, load, (run) => frames.push(run));
  const runFrame = async () => {
    frames.shift()?.();
    await vi.waitFor(() => expect(steps.profile).toHaveBeenCalled());
  };
  return { steps, frames, loop, runFrame };
};

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('createRenderLoop', () => {
  it('asks for one frame however often it is scheduled before the frame comes', () => {
    const { loop, frames } = setup();
    loop.schedule();
    loop.schedule();
    loop.schedule();
    expect(frames).toHaveLength(1);
  });

  it('prices only the cards queued since the last frame', async () => {
    const { loop, steps, runFrame } = setup();
    const [first, second] = [link('a'), link('b')];
    loop.addCards([first, second, first]);
    loop.schedule();
    await runFrame();
    expect(steps.cards).toHaveBeenCalledExactlyOnceWith(db, [first, second]);
    steps.profile.mockClear();
    loop.schedule();
    await runFrame();
    expect(steps.cards).toHaveBeenCalledOnce();
  });

  it('redraws trade summaries only after a trade change was marked', async () => {
    const { loop, steps, runFrame } = setup();
    loop.schedule();
    await runFrame();
    expect(steps.trades).not.toHaveBeenCalled();
    steps.profile.mockClear();
    loop.markTrades();
    loop.schedule();
    await runFrame();
    expect(steps.trades).toHaveBeenCalledExactlyOnceWith(db);
  });

  it('renders everything on a full pass and drops what was waiting for a frame', async () => {
    const { loop, steps, runFrame } = setup();
    loop.addCards([link('a')]);
    loop.markTrades();
    await loop.renderAll();
    expect(steps.cards).toHaveBeenCalledExactlyOnceWith(db);
    expect(steps.trades).toHaveBeenCalledOnce();
    loop.schedule();
    steps.profile.mockClear();
    await runFrame();
    expect(steps.cards).toHaveBeenCalledOnce();
    expect(steps.trades).toHaveBeenCalledOnce();
  });

  it('logs a failed database load instead of throwing it', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { loop, steps } = setup(() => Promise.reject(new Error('offline')));
    await expect(loop.renderAll()).resolves.toBeUndefined();
    expect(steps.cards).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledOnce();
  });
});

describe('addedCards', () => {
  it('finds card links added directly and inside added subtrees', () => {
    const direct = link('a');
    const wrapper = document.createElement('div');
    const nested = link('b');
    wrapper.append(nested);
    const records = [{ addedNodes: [direct, document.createTextNode('x')] }, { addedNodes: [wrapper] }] as unknown as MutationRecord[];
    expect(addedCards(records)).toEqual([direct, nested]);
  });
});
