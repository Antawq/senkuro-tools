import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import type { Database } from '../utils/shared/database';
import { addedCards, createRenderLoop, type RenderStep } from '../utils/shared/render-loop';

const db: Database = {};

const link = (slug: string): HTMLAnchorElement => {
  const a = document.createElement('a');
  a.className = 'card-collect';
  a.href = `/cards/${slug}`;
  return a;
};

const setup = (load: () => Promise<Database> = () => Promise.resolve(db)) => {
  const steps = {
    cards: vi.fn<RenderStep['render']>(),
    trades: vi.fn<RenderStep['render']>(),
    profile: vi.fn<RenderStep['render']>(),
    sort: vi.fn<RenderStep['render']>(),
  };
  const frames: (() => void)[] = [];
  const loop = createRenderLoop(
    [
      { name: 'cards', trigger: 'cards', render: steps.cards },
      { name: 'trades', trigger: 'trades', render: steps.trades },
      { name: 'profile', render: steps.profile },
      { name: 'sort', render: steps.sort },
    ],
    load,
    (run) => frames.push(run)
  );
  const runFrame = async () => {
    frames.shift()?.();
    await vi.waitFor(() => expect(steps.profile).toHaveBeenCalled());
  };
  return { steps, frames, loop, runFrame };
};

const breakStep = (step: Mock<RenderStep['render']>, error: Error) =>
  step.mockImplementation(() => {
    throw error;
  });

const spyConsoleError = () => vi.spyOn(console, 'error').mockImplementation(() => undefined);

const callCounts = (...steps: Mock<RenderStep['render']>[]) => steps.map((step) => step.mock.calls.length);

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

  it('puts the cards in order on every frame and on a full pass, after the profile', async () => {
    const { loop, steps, runFrame } = setup();
    const calls: string[] = [];
    steps.profile.mockImplementation(() => void calls.push('profile'));
    steps.sort.mockImplementation(() => void calls.push('sort'));
    loop.schedule();
    await runFrame();
    await loop.renderAll();
    expect(steps.sort).toHaveBeenCalledTimes(2);
    expect(steps.sort).toHaveBeenCalledWith(db);
    expect(calls).toEqual(['profile', 'sort', 'profile', 'sort']);
  });

  it('logs a failed database load instead of throwing it', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { loop, steps } = setup(() => Promise.reject(new Error('offline')));
    await expect(loop.renderAll()).resolves.toBeUndefined();
    expect(steps.cards).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledOnce();
  });

  it('runs the other steps of a full pass when the cards step throws, and logs the error with the step name', async () => {
    const logged = spyConsoleError();
    const { loop, steps } = setup();
    const broken = new Error('cards broke');
    breakStep(steps.cards, broken);
    await loop.renderAll();
    expect(callCounts(steps.trades, steps.profile, steps.sort)).toEqual([1, 1, 1]);
    expect(logged).toHaveBeenCalledExactlyOnceWith('SenkuTools: render step cards failed', broken);
  });

  it('runs the other steps of a frame when the cards step throws', async () => {
    const logged = spyConsoleError();
    const { loop, steps, runFrame } = setup();
    breakStep(steps.cards, new Error('cards broke'));
    loop.addCards([link('a')]);
    loop.markTrades();
    loop.schedule();
    await runFrame();
    expect(callCounts(steps.cards, steps.trades, steps.profile, steps.sort)).toEqual([1, 1, 1, 1]);
    expect(logged).toHaveBeenCalledOnce();
  });

  it('runs the sort step of a frame and of a full pass when the profile step throws', async () => {
    const logged = spyConsoleError();
    const { loop, steps, runFrame } = setup();
    const broken = new Error('profile broke');
    breakStep(steps.profile, broken);
    loop.schedule();
    await runFrame();
    await loop.renderAll();
    expect(callCounts(steps.cards, steps.trades, steps.profile, steps.sort)).toEqual([1, 1, 2, 2]);
    expect(logged.mock.calls).toEqual([
      ['SenkuTools: render step profile failed', broken],
      ['SenkuTools: render step profile failed', broken],
    ]);
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
