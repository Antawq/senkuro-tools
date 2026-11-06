import { afterEach, beforeEach, describe, expect, it, vi, type Mock, type MockInstance } from 'vitest';

import type { PosterArt } from '../utils/poster/poster-art';
import type { SelectedCard } from '../utils/poster/poster-cards';
import { POSTER_TEXT, closePosterDialogs, closeStalePosterDialogs, fileNameOf, openPosterDialog, type PosterDialogHost } from '../utils/poster/poster-dialog';
import { POSTER_MAX_CARDS } from '../utils/poster/poster-layout';
import type { PosterContent } from '../utils/poster/poster-render';

const cardOf = (slug: string, overrides: Partial<SelectedCard> = {}): SelectedCard => ({ slug, quantity: 1, ...overrides });

const artOf = (slug: string): PosterArt => ({ slug, rank: 'S', url: `https://cdn.example/${slug}.webp`, width: 400, height: 600, isExplicit: false });

const settle = async (): Promise<void> => {
  for (let step = 0; step < 6; step++) await Promise.resolve();
};

interface Rig {
  host: PosterDialogHost;
  frames: (() => void)[];
  contents: PosterContent[];
  closes: Mock<() => void>[];
  flushFrames: () => Promise<void>;
  fetchArt: Mock<PosterDialogHost['fetchArt']>;
  loadImage: Mock<PosterDialogHost['loadImage']>;
  fetchNickname: Mock<PosterDialogHost['fetchNickname']>;
  render: Mock<PosterDialogHost['render']>;
  download: Mock<PosterDialogHost['download']>;
  copyImage: Mock<PosterDialogHost['copyImage']>;
}

const createRig = (overrides: Partial<PosterDialogHost> = {}): Rig => {
  const frames: (() => void)[] = [];
  const contents: PosterContent[] = [];
  const closes: Mock<() => void>[] = [];
  const fetchArt = vi.fn<PosterDialogHost['fetchArt']>((slugs) => Promise.resolve(new Map(slugs.map((slug) => [slug, artOf(slug)]))));
  const loadImage = vi.fn<PosterDialogHost['loadImage']>(() => {
    const close = vi.fn<() => void>();
    closes.push(close);
    return Promise.resolve({ width: 400, height: 600, close });
  });
  const fetchNickname = vi.fn<PosterDialogHost['fetchNickname']>(() => Promise.resolve('Sena'));
  const render = vi.fn<PosterDialogHost['render']>((content) => {
    contents.push(content);
    return Promise.resolve(new Blob([`poster-${contents.length}`], { type: 'image/png' }));
  });
  const download = vi.fn<PosterDialogHost['download']>();
  const copyImage = vi.fn<PosterDialogHost['copyImage']>(() => Promise.resolve());
  const host: PosterDialogHost = {
    pageDocument: document,
    database: { 'alpha-s': { price: 10, name: 'Alpha', rank: 'S' } },
    settings: { commission: true },
    fetchArt,
    loadImage,
    fetchNickname,
    render,
    nextFrame: (run) => void frames.push(run),
    download,
    copyImage,
    ...overrides,
  };
  const flushFrames = async (): Promise<void> => {
    frames.splice(0).forEach((run) => run());
    await settle();
  };
  return { host, frames, contents, closes, flushFrames, fetchArt, loadImage, fetchNickname, render, download, copyImage };
};

const find = <T extends Element>(selector: string): T => {
  const node = document.querySelector<T>(selector);
  if (!node) throw new Error(`missing ${selector}`);
  return node;
};

const note = (): string => find('.senkutools-poster__note').textContent ?? '';
const heading = (): HTMLInputElement => find('.senkutools-poster__heading');
const toggle = (name: string): HTMLInputElement => find(`.senkutools-poster__${name}`);
const press = (name: string): void => find<HTMLButtonElement>(`.senkutools-poster__${name}`).click();
const change = (input: HTMLInputElement, isChecked: boolean): void => {
  input.checked = isChecked;
  input.dispatchEvent(new Event('change', { bubbles: true }));
};

const openReady = async (rig: Rig, cards: readonly SelectedCard[] = [cardOf('alpha-s'), cardOf('beta-a')], profileSlug = 'sena'): Promise<void> => {
  openPosterDialog(cards, profileSlug, rig.host);
  await settle();
  await rig.flushFrames();
};

let urlCount = 0;
let createUrl: MockInstance<typeof URL.createObjectURL>;
let revokeUrl: MockInstance<typeof URL.revokeObjectURL>;

beforeEach(() => {
  document.body.innerHTML = '';
  window.history.pushState({}, '', '/users/sena/cards');
  urlCount = 0;
  createUrl = vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:poster-${++urlCount}`);
  revokeUrl = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
});

afterEach(() => {
  closePosterDialogs(document);
  vi.restoreAllMocks();
});

describe('openPosterDialog', () => {
  it('opens a modal dialog with the fixed structure and the default control state', async () => {
    const rig = createRig();
    await openReady(rig);
    const dialog = find<HTMLDialogElement>('dialog.senkutools-poster');
    expect(dialog.open).toBe(true);
    expect(dialog.getAttribute('aria-label')).toBe(POSTER_TEXT.title);
    expect(heading().value).toBe('');
    expect(heading().maxLength).toBe(60);
    expect([toggle('nickname').checked, toggle('quantity').checked, toggle('prices').checked]).toEqual([true, true, false]);
    for (const selector of ['.senkutools-poster__image', '.senkutools-poster__download', '.senkutools-poster__copy', '.senkutools-poster__close']) {
      expect(dialog.querySelector(selector)).not.toBeNull();
    }
  });

  it('asks for the art of the shown cards once and renders the poster after it loads', async () => {
    const rig = createRig();
    await openReady(rig);
    expect(rig.fetchArt).toHaveBeenCalledTimes(1);
    expect(rig.fetchArt.mock.calls[0]?.[0]).toEqual(['alpha-s', 'beta-a']);
    expect(rig.render).toHaveBeenCalledTimes(1);
    expect(find<HTMLImageElement>('.senkutools-poster__image').src).toBe('blob:poster-1');
  });

  it('draws every selected card and adds no note about hidden ones', async () => {
    const rig = createRig();
    await openReady(rig, [cardOf('alpha-s'), cardOf('adult-x')]);
    expect(rig.fetchArt.mock.calls[0]?.[0]).toEqual(['alpha-s', 'adult-x']);
    expect(rig.contents[0]?.cards).toHaveLength(2);
    expect(note()).toBe('');
  });

  it('draws the first 30 cards and says how many did not fit', async () => {
    const rig = createRig();
    const cards = Array.from({ length: POSTER_MAX_CARDS + 2 }, (_, index) => cardOf(`card-${index}`));
    await openReady(rig, cards);
    expect(rig.fetchArt.mock.calls[0]?.[0]).toHaveLength(POSTER_MAX_CARDS);
    expect(rig.contents[0]?.cards).toHaveLength(POSTER_MAX_CARDS);
    expect(note()).toContain(POSTER_TEXT.leftOut(2));
  });

  it('asks for nothing when no card is selected and keeps the buttons off', async () => {
    const rig = createRig();
    await openReady(rig, []);
    expect(rig.fetchArt).not.toHaveBeenCalled();
    expect(note()).toContain(POSTER_TEXT.nothingToDraw);
    expect(find('.senkutools-poster__download').getAttribute('aria-disabled')).toBe('true');
  });

  it('keeps the buttons off until a poster exists and never uses the disabled attribute', async () => {
    const rig = createRig();
    openPosterDialog([cardOf('alpha-s')], 'sena', rig.host);
    const download = find<HTMLButtonElement>('.senkutools-poster__download');
    expect(download.getAttribute('aria-disabled')).toBe('true');
    press('download');
    expect(rig.download).not.toHaveBeenCalled();
    await settle();
    await rig.flushFrames();
    expect(download.hasAttribute('aria-disabled')).toBe(false);
    expect([download.disabled, find<HTMLButtonElement>('.senkutools-poster__copy').disabled]).toEqual([false, false]);
  });

  it('shows the art error and keeps the buttons off when the art request fails', async () => {
    const rig = createRig();
    rig.fetchArt.mockRejectedValueOnce(new Error('offline'));
    await openReady(rig);
    expect(note()).toContain(POSTER_TEXT.artFailed);
    expect(rig.render).not.toHaveBeenCalled();
    expect(find('.senkutools-poster__copy').getAttribute('aria-disabled')).toBe('true');
  });

  it('draws a placeholder for a card whose image fails and counts it', async () => {
    const rig = createRig();
    rig.loadImage.mockRejectedValueOnce(new Error('bad image'));
    await openReady(rig, [cardOf('alpha-s'), cardOf('beta-a'), cardOf('gamma-b')]);
    expect(rig.contents[0]?.cards.map((card) => card.image === null)).toEqual([true, false, false]);
    expect(note()).toContain(POSTER_TEXT.imagesFailed(1));
  });

  it('counts a slug the art request did not return as a failed image', async () => {
    const rig = createRig();
    rig.fetchArt.mockResolvedValueOnce(new Map([['alpha-s', artOf('alpha-s')]]));
    await openReady(rig, [cardOf('alpha-s'), cardOf('beta-a'), cardOf('gamma-b')]);
    expect(rig.contents[0]?.cards.map((card) => card.image === null)).toEqual([false, true, true]);
    expect(note()).toContain(POSTER_TEXT.imagesFailed(2));
  });

  it('leaves the note empty when nothing was left out or failed', async () => {
    const rig = createRig();
    await openReady(rig);
    expect(note()).toBe('');
  });

  it('closes an open poster dialog before it opens the next one', async () => {
    const rig = createRig();
    await openReady(rig);
    await openReady(rig);
    expect(document.querySelectorAll('dialog.senkutools-poster[open]')).toHaveLength(1);
  });
});

describe('render requests', () => {
  it('makes one render for a heading and a toggle changed in the same frame', async () => {
    const rig = createRig();
    await openReady(rig);
    rig.render.mockClear();
    heading().value = 'Меняю';
    heading().dispatchEvent(new Event('input', { bubbles: true }));
    change(toggle('quantity'), false);
    change(toggle('prices'), true);
    expect(rig.frames).toHaveLength(1);
    await rig.flushFrames();
    expect(rig.render).toHaveBeenCalledTimes(1);
    expect(rig.contents.at(-1)).toMatchObject({ heading: 'Меняю', shouldShowQuantity: false });
  });

  it('prices a card with the commission, without it, with a question mark when the database lacks it, and with null when prices are off', async () => {
    const withCommission = createRig();
    await openReady(withCommission);
    expect(withCommission.contents[0]?.cards.map((card) => card.priceText)).toEqual([null, null]);
    change(toggle('prices'), true);
    await withCommission.flushFrames();
    expect(withCommission.contents.at(-1)?.cards.map((card) => card.priceText)).toEqual(['8.00', '?']);
    closePosterDialogs(document);
    const withoutCommission = createRig({ settings: { commission: false } });
    await openReady(withoutCommission);
    change(toggle('prices'), true);
    await withoutCommission.flushFrames();
    expect(withoutCommission.contents.at(-1)?.cards.map((card) => card.priceText)).toEqual(['10.00', '?']);
  });

  it('passes the quantity of every card and the quantity toggle to the renderer', async () => {
    const rig = createRig();
    await openReady(rig, [cardOf('alpha-s', { quantity: 3 }), cardOf('beta-a')]);
    expect(rig.contents[0]).toMatchObject({ shouldShowQuantity: true });
    expect(rig.contents[0]?.cards.map((card) => card.selected.quantity)).toEqual([3, 1]);
  });

  it('never lets an older render replace a newer one', async () => {
    const answers: ((blob: Blob) => void)[] = [];
    const rig = createRig();
    rig.render.mockImplementation(() => new Promise<Blob>((resolve) => answers.push(resolve)));
    await openReady(rig);
    change(toggle('prices'), true);
    await rig.flushFrames();
    expect(answers).toHaveLength(2);
    answers[1]?.(new Blob(['newer'], { type: 'image/png' }));
    await settle();
    answers[0]?.(new Blob(['older'], { type: 'image/png' }));
    await settle();
    expect(createUrl).toHaveBeenCalledTimes(1);
    expect(createUrl.mock.calls[0]?.[0]).toMatchObject({ size: 5 });
  });

  it('shows a render error and turns the buttons off when the renderer fails', async () => {
    const rig = createRig();
    await openReady(rig);
    rig.render.mockRejectedValueOnce(new Error('canvas'));
    change(toggle('quantity'), false);
    await rig.flushFrames();
    expect(note()).toContain(POSTER_TEXT.renderFailed);
    expect(find('.senkutools-poster__download').getAttribute('aria-disabled')).toBe('true');
  });

  it('revokes the previous preview url when a new poster arrives', async () => {
    const rig = createRig();
    await openReady(rig);
    change(toggle('quantity'), false);
    await rig.flushFrames();
    expect(revokeUrl).toHaveBeenCalledWith('blob:poster-1');
    expect(find<HTMLImageElement>('.senkutools-poster__image').src).toBe('blob:poster-2');
  });
});

describe('nickname', () => {
  it('is requested once for the profile at open and shown on the poster', async () => {
    const rig = createRig();
    await openReady(rig, [cardOf('alpha-s')], 'sena');
    expect(rig.fetchNickname).toHaveBeenCalledTimes(1);
    expect(rig.fetchNickname.mock.calls[0]?.[0]).toBe('sena');
    expect(rig.contents.at(-1)?.nickname).toBe('Sena');
  });

  it('is dropped from the poster when the toggle is off and not requested again when it comes back', async () => {
    const rig = createRig();
    await openReady(rig);
    change(toggle('nickname'), false);
    await rig.flushFrames();
    expect(rig.contents.at(-1)?.nickname).toBeNull();
    change(toggle('nickname'), true);
    await rig.flushFrames();
    expect(rig.fetchNickname).toHaveBeenCalledTimes(1);
    expect(rig.contents.at(-1)?.nickname).toBe('Sena');
  });

  it('says so and leaves the footer out when the nickname request fails', async () => {
    const rig = createRig();
    rig.fetchNickname.mockRejectedValueOnce(new Error('offline'));
    await openReady(rig);
    expect(note()).toContain(POSTER_TEXT.nicknameFailed);
    expect(rig.contents.at(-1)?.nickname).toBeNull();
  });
});

describe('buttons', () => {
  it('downloads the last poster under a file name made from the profile slug', async () => {
    const rig = createRig();
    await openReady(rig, [cardOf('alpha-s')], '@2494');
    press('download');
    expect(rig.download).toHaveBeenCalledTimes(1);
    expect(rig.download.mock.calls[0]?.[1]).toBe('senkutools-poster-2494.png');
    expect((rig.download.mock.calls[0]?.[0] as Blob).size).toBeGreaterThan(0);
  });

  it('says it copied the image, and says so when the copy is refused', async () => {
    const rig = createRig();
    await openReady(rig);
    press('copy');
    await settle();
    expect(note()).toContain(POSTER_TEXT.copied);
    rig.copyImage.mockRejectedValueOnce(new Error('denied'));
    press('copy');
    await settle();
    expect(note()).toContain(POSTER_TEXT.copyFailed);
    expect(note()).not.toContain(POSTER_TEXT.copied);
  });

  it('clears the copy note when the poster is rendered again', async () => {
    const rig = createRig();
    await openReady(rig);
    press('copy');
    await settle();
    change(toggle('quantity'), false);
    await rig.flushFrames();
    expect(note()).not.toContain(POSTER_TEXT.copied);
  });
});

describe('closing', () => {
  it('removes the dialog, revokes the preview url and closes the bitmaps when the close button is pressed', async () => {
    const rig = createRig();
    await openReady(rig);
    press('close');
    expect(document.querySelector('dialog.senkutools-poster')).toBeNull();
    expect(revokeUrl).toHaveBeenCalledWith('blob:poster-1');
    expect(rig.closes).toHaveLength(2);
    for (const close of rig.closes) expect(close).toHaveBeenCalledTimes(1);
  });

  it('aborts the requests and ignores answers that arrive after the close', async () => {
    const rig = createRig();
    let release: (arts: Map<string, PosterArt>) => void = () => undefined;
    rig.fetchArt.mockImplementation(
      () =>
        new Promise<Map<string, PosterArt>>((resolve) => {
          release = resolve;
        })
    );
    openPosterDialog([cardOf('alpha-s')], 'sena', rig.host);
    const signal = rig.fetchArt.mock.calls[0]?.[1];
    press('close');
    expect(signal?.aborted).toBe(true);
    release(new Map([['alpha-s', artOf('alpha-s')]]));
    await settle();
    await rig.flushFrames();
    expect(rig.render).not.toHaveBeenCalled();
    expect(createUrl).not.toHaveBeenCalled();
  });

  it('closes a dialog opened on another page path and keeps one opened on this path', async () => {
    const rig = createRig();
    await openReady(rig);
    closeStalePosterDialogs(document);
    expect(document.querySelector('dialog.senkutools-poster')).not.toBeNull();
    window.history.pushState({}, '', '/users/other/cards');
    closeStalePosterDialogs(document);
    expect(document.querySelector('dialog.senkutools-poster')).toBeNull();
  });
});

describe('fileNameOf', () => {
  it('keeps a plain slug', () => {
    expect(fileNameOf('sena')).toBe('senkutools-poster-sena.png');
  });

  it('replaces unsafe characters and trims the edges', () => {
    expect(fileNameOf('@24/94 x')).toBe('senkutools-poster-24-94-x.png');
  });

  it('falls back to a fixed word when nothing safe is left', () => {
    expect(fileNameOf('@@@')).toBe('senkutools-poster-poster.png');
  });
});
