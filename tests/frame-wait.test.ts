import { describe, expect, it } from 'vitest';

import { createFrameWait } from '../utils/shared/frame-wait';

const frames = (): { nextFrame: (run: () => void) => void; run: () => void; count: () => number } => {
  const queue: (() => void)[] = [];
  let count = 0;
  return {
    nextFrame: (run) => void queue.push(run),
    run: () => {
      count += 1;
      queue.splice(0).forEach((run) => run());
    },
    count: () => count,
  };
};

describe('createFrameWait', () => {
  it('answers at once with what it already finds', async () => {
    const wait = createFrameWait(frames().nextFrame);
    expect(await wait(() => 'found')).toBe('found');
  });

  it('looks again every frame until it finds something', async () => {
    const clock = frames();
    let value: string | null = null;
    const answer = createFrameWait(clock.nextFrame)(() => value);
    clock.run();
    clock.run();
    value = 'later';
    clock.run();
    expect(await answer).toBe('later');
  });

  it('gives up with null after the frame limit', async () => {
    const clock = frames();
    let looks = 0;
    const answer = createFrameWait(
      clock.nextFrame,
      3
    )(() => {
      looks += 1;
      return null;
    });
    for (let frame = 0; frame < 5; frame++) clock.run();
    expect(await answer).toBeNull();
    expect(looks).toBe(3);
  });

  it('treats a falsy value that is not null or undefined as found', async () => {
    const wait = createFrameWait(frames().nextFrame);
    expect(await wait(() => 0)).toBe(0);
    expect(await wait(() => '')).toBe('');
    expect(await wait(() => false)).toBe(false);
  });

  it('keeps no waiting frame once it has found the value', async () => {
    const clock = frames();
    let value: string | null = null;
    const answer = createFrameWait(clock.nextFrame)(() => value);
    value = 'x';
    clock.run();
    await answer;
    expect(clock.count()).toBe(1);
  });
});
