const FRAME_LIMIT = 60;

export type FrameWait = <Value>(look: () => Value | null | undefined) => Promise<Value | null>;

export function createFrameWait(nextFrame: (run: () => void) => void, frameLimit: number = FRAME_LIMIT): FrameWait {
  return (look) =>
    new Promise((resolve) => {
      let framesLeft = frameLimit;
      const step = (): void => {
        const value = look();
        if (value !== null && value !== undefined) return resolve(value);
        framesLeft -= 1;
        if (framesLeft <= 0) return resolve(null);
        nextFrame(step);
      };
      step();
    });
}
