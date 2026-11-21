import { describe, expect, it, vi } from 'vitest';

import { LOSSY_QUALITY, encodePoster, extensionOf, type EncodeHost } from '../utils/poster/poster-format';

interface FakeCanvas {
  canvas: HTMLCanvasElement;
  drawn: unknown[];
  asked: { type: string; quality: number | undefined }[];
}

const fakeCanvas = (produce: (type: string) => Blob | null): FakeCanvas => {
  const drawn: unknown[] = [];
  const asked: { type: string; quality: number | undefined }[] = [];
  const canvas = {
    getContext: () => ({ drawImage: (image: unknown) => drawn.push(image) }),
    toBlob: (callback: (blob: Blob | null) => void, type: string, quality?: number) => {
      asked.push({ type, quality });
      callback(produce(type));
    },
  } as unknown as HTMLCanvasElement;
  return { canvas, drawn, asked };
};

const bitmapOf = () => {
  const close = vi.fn<() => void>();
  return { bitmap: { width: 1200, height: 900, close } as unknown as ImageBitmap, close };
};

const png = new Blob(['png-poster'], { type: 'image/png' });

describe('extensionOf', () => {
  it('names the file after the type the browser actually produced', () => {
    expect(extensionOf(new Blob([], { type: 'image/png' }))).toBe('png');
    expect(extensionOf(new Blob([], { type: 'image/jpeg' }))).toBe('jpg');
    expect(extensionOf(new Blob([], { type: 'image/webp' }))).toBe('webp');
    expect(extensionOf(new Blob([], { type: 'image/avif' }))).toBe('png');
  });
});

describe('encodePoster', () => {
  it('gives the rendered png back untouched for the png choice', async () => {
    const createBitmap = vi.fn<EncodeHost['createBitmap']>();
    expect(await encodePoster(png, 'png', { createBitmap, createCanvas: () => fakeCanvas(() => null).canvas })).toBe(png);
    expect(createBitmap).not.toHaveBeenCalled();
  });

  it.each([
    ['jpeg', 'image/jpeg'],
    ['webp', 'image/webp'],
  ] as const)('redraws the poster at its own size and asks the canvas for %s at the lossy quality', async (format, type) => {
    const { bitmap, close } = bitmapOf();
    const fake = fakeCanvas((asked) => new Blob(['encoded'], { type: asked }));
    const createCanvas = vi.fn<EncodeHost['createCanvas']>(() => fake.canvas);
    const encoded = await encodePoster(png, format, { createBitmap: () => Promise.resolve(bitmap), createCanvas });
    expect(createCanvas).toHaveBeenCalledWith(1200, 900);
    expect(fake.drawn).toEqual([bitmap]);
    expect(fake.asked).toEqual([{ type, quality: LOSSY_QUALITY }]);
    expect(encoded.type).toBe(type);
    expect(close).toHaveBeenCalledOnce();
  });

  it('keeps the png the browser falls back to when it cannot encode the chosen type', async () => {
    const fake = fakeCanvas(() => new Blob(['fallback'], { type: 'image/png' }));
    const encoded = await encodePoster(png, 'webp', { createBitmap: () => Promise.resolve(bitmapOf().bitmap), createCanvas: () => fake.canvas });
    expect(extensionOf(encoded)).toBe('png');
  });

  it('frees the bitmap and rejects when the canvas produces nothing', async () => {
    const { bitmap, close } = bitmapOf();
    const fake = fakeCanvas(() => null);
    await expect(encodePoster(png, 'jpeg', { createBitmap: () => Promise.resolve(bitmap), createCanvas: () => fake.canvas })).rejects.toThrow();
    expect(close).toHaveBeenCalledOnce();
  });
});
