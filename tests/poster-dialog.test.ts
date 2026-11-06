import { afterEach, beforeEach, describe, expect, it, vi, type Mock, type MockInstance } from 'vitest';

import type { PosterArt } from '../utils/poster/poster-art';
import type { SelectedCard } from '../utils/poster/poster-cards';
import {
  POSTER_TEXT,
  archiveNameOf,
  closePosterDialogs,
  closeStalePosterDialogs,
  fileNameOf,
  openPosterDialog,
  type PosterDialogHost,
} from '../utils/poster/poster-dialog';
import { POSTER_CARDS_PER_PAGE } from '../utils/poster/poster-layout';
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
  pack: Mock<PosterDialogHost['pack']>;
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
  const pack = vi.fn<PosterDialogHost['pack']>((entries) =>
    Promise.resolve(new Blob([entries.map((entry) => entry.name).join('|')], { type: 'application/zip' }))
  );
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
    pack,
    nextFrame: (run) => void frames.push(run),
    download,
    copyImage,
    ...overrides,
  };
  const flushFrames = async (): Promise<void> => {
    frames.splice(0).forEach((run) => run());
    await settle();
  };
  return { host, frames, contents, closes, flushFrames, fetchArt, loadImage, fetchNickname, render, pack, download, copyImage };
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

const cardsOf = (count: number): SelectedCard[] => Array.from({ length: count }, (_, index) => cardOf(`card-${index}`));

const slugsOf = (content: PosterContent | undefined): string[] => (content?.cards ?? []).map((card) => card.selected.slug);

const sliceOf = (from: number, to: number): string[] => Array.from({ length: to - from }, (_, index) => `card-${from + index}`);

const settleLong = async (): Promise<void> => {
  for (let step = 0; step < 60; step++) await Promise.resolve();
};

const isDisabled = (selector: string): boolean => find(selector).getAttribute('aria-disabled') === 'true';

const position = (): string => find('.senkutools-poster__position').textContent ?? '';

const goTo = async (rig: Rig, name: 'next' | 'previous'): Promise<void> => {
  press(name);
  await settle();
  await rig.flushFrames();
};

describe('pages', () => {
  it('shows no pager and no zip button for one page of cards and names the png after the profile', async () => {
    const rig = createRig();
    await openReady(rig, cardsOf(POSTER_CARDS_PER_PAGE));
    expect(document.querySelector('.senkutools-poster__pager')).toBeNull();
    expect(document.querySelector('.senkutools-poster__download-all')).toBeNull();
    press('download');
    expect(rig.download).toHaveBeenCalledWith(expect.any(Blob), 'senkutools-poster-sena.png');
  });

  it('splits more cards into balanced pages and draws the first one without a note about the rest', async () => {
    const rig = createRig();
    await openReady(rig, cardsOf(POSTER_CARDS_PER_PAGE + 1));
    expect(rig.fetchArt).toHaveBeenCalledTimes(1);
    expect(rig.fetchArt.mock.calls[0]?.[0]).toEqual(sliceOf(0, 16));
    expect(slugsOf(rig.contents[0])).toEqual(sliceOf(0, 16));
    expect(position()).toBe(POSTER_TEXT.position(1, 2));
    expect(note()).toBe('');
    expect(isDisabled('.senkutools-poster__previous')).toBe(true);
    expect(isDisabled('.senkutools-poster__next')).toBe(false);
    expect(find('.senkutools-poster__preview').classList.contains('senkutools-poster__preview--paged')).toBe(true);
  });

  it('draws the next page, frees the bitmaps of the page it leaves and numbers the png', async () => {
    const rig = createRig();
    await openReady(rig, cardsOf(POSTER_CARDS_PER_PAGE + 1));
    await goTo(rig, 'next');
    expect(rig.fetchArt.mock.calls[1]?.[0]).toEqual(sliceOf(16, 31));
    expect(slugsOf(rig.contents[1])).toEqual(sliceOf(16, 31));
    expect(position()).toBe(POSTER_TEXT.position(2, 2));
    expect(rig.closes.slice(0, 16).every((close) => close.mock.calls.length === 1)).toBe(true);
    expect(rig.closes.slice(16).every((close) => close.mock.calls.length === 0)).toBe(true);
    expect(isDisabled('.senkutools-poster__previous')).toBe(false);
    expect(isDisabled('.senkutools-poster__next')).toBe(true);
    press('download');
    expect(rig.download).toHaveBeenLastCalledWith(expect.any(Blob), 'senkutools-poster-sena-2.png');
  });

  it('does not go past the last page or before the first one', async () => {
    const rig = createRig();
    await openReady(rig, cardsOf(POSTER_CARDS_PER_PAGE + 1));
    await goTo(rig, 'previous');
    expect(rig.fetchArt).toHaveBeenCalledTimes(1);
    await goTo(rig, 'next');
    await goTo(rig, 'next');
    expect(rig.fetchArt).toHaveBeenCalledTimes(2);
    expect(position()).toBe(POSTER_TEXT.position(2, 2));
  });

  it('returns to a page without asking for its art again', async () => {
    const rig = createRig();
    await openReady(rig, cardsOf(POSTER_CARDS_PER_PAGE + 1));
    await goTo(rig, 'next');
    await goTo(rig, 'previous');
    expect(rig.fetchArt).toHaveBeenCalledTimes(2);
    expect(slugsOf(rig.contents[2])).toEqual(sliceOf(0, 16));
    expect(rig.loadImage).toHaveBeenCalledTimes(16 + 15 + 16);
  });

  it('keeps the pager and the buttons off while a page loads and ignores clicks on it', async () => {
    let finish: (arts: Map<string, PosterArt>) => void = () => undefined;
    const fetchArt = vi.fn<PosterDialogHost['fetchArt']>((slugs) =>
      slugs.includes('card-16') ? new Promise((resolve) => void (finish = resolve)) : Promise.resolve(new Map(slugs.map((slug) => [slug, artOf(slug)])))
    );
    const rig = createRig({ fetchArt });
    await openReady(rig, cardsOf(POSTER_CARDS_PER_PAGE + 1));
    press('next');
    await settle();
    expect([
      isDisabled('.senkutools-poster__previous'),
      isDisabled('.senkutools-poster__next'),
      isDisabled('.senkutools-poster__download'),
      isDisabled('.senkutools-poster__download-all'),
    ]).toEqual([true, true, true, true]);
    expect(note()).toBe(POSTER_TEXT.loading);
    press('next');
    press('previous');
    press('download-all');
    expect(fetchArt).toHaveBeenCalledTimes(2);
    expect(rig.pack).not.toHaveBeenCalled();
    finish(new Map(sliceOf(16, 31).map((slug) => [slug, artOf(slug)])));
    await settle();
    await rig.flushFrames();
    expect(note()).toBe('');
    expect(isDisabled('.senkutools-poster__previous')).toBe(false);
  });

  it('says the art failed, leaves the pager free and loads the other page from the cache', async () => {
    const fetchArt = vi.fn<PosterDialogHost['fetchArt']>((slugs) =>
      slugs.includes('card-16') ? Promise.reject(new Error('offline')) : Promise.resolve(new Map(slugs.map((slug) => [slug, artOf(slug)])))
    );
    const rig = createRig({ fetchArt });
    await openReady(rig, cardsOf(POSTER_CARDS_PER_PAGE + 1));
    await goTo(rig, 'next');
    expect(note()).toBe(POSTER_TEXT.artFailed);
    expect(isDisabled('.senkutools-poster__previous')).toBe(false);
    expect(isDisabled('.senkutools-poster__download')).toBe(true);
    expect(isDisabled('.senkutools-poster__download-all')).toBe(true);
    await goTo(rig, 'previous');
    expect(note()).toBe('');
    expect(fetchArt).toHaveBeenCalledTimes(2);
    expect(isDisabled('.senkutools-poster__download')).toBe(false);
  });

  it('counts the pictures that did not load on the page it shows', async () => {
    const loadImage = vi.fn<PosterDialogHost['loadImage']>((art) =>
      art.slug === 'card-3' ? Promise.reject(new Error('gone')) : Promise.resolve({ width: 400, height: 600, close: vi.fn() })
    );
    const rig = createRig({ loadImage });
    await openReady(rig, cardsOf(POSTER_CARDS_PER_PAGE + 1));
    expect(note()).toBe(POSTER_TEXT.imagesFailed(1));
    await goTo(rig, 'next');
    expect(note()).toBe('');
  });

  it('closes bitmaps that finish loading after the dialog was closed', async () => {
    let finish: (bitmap: ImageBitmap) => void = () => undefined;
    const close = vi.fn<() => void>();
    const loadImage = vi.fn<PosterDialogHost['loadImage']>(() => new Promise((resolve) => void (finish = resolve)));
    const rig = createRig({ loadImage });
    openPosterDialog(cardsOf(1), 'sena', rig.host);
    await settle();
    closePosterDialogs(document);
    finish({ width: 400, height: 600, close });
    await settle();
    expect(close).toHaveBeenCalledTimes(1);
  });
});

const SIXTY_ONE = 61;

describe('download all', () => {
  it('renders every page with the settings of the click and downloads one zip', async () => {
    const rig = createRig();
    await openReady(rig, cardsOf(SIXTY_ONE));
    rig.render.mockClear();
    rig.loadImage.mockClear();
    heading().value = 'Меняю';
    change(toggle('prices'), true);
    press('download-all');
    await settleLong();
    expect(rig.render).toHaveBeenCalledTimes(3);
    expect(rig.render.mock.calls.map(([content]) => slugsOf(content))).toEqual([sliceOf(0, 21), sliceOf(21, 41), sliceOf(41, 61)]);
    for (const [content] of rig.render.mock.calls) {
      expect(content.heading).toBe('Меняю');
      expect(content.cards.every((card) => card.priceText !== null)).toBe(true);
    }
    expect(rig.pack).toHaveBeenCalledTimes(1);
    expect(rig.pack.mock.calls[0]?.[0].map((entry) => entry.name)).toEqual([
      'senkutools-poster-sena-1.png',
      'senkutools-poster-sena-2.png',
      'senkutools-poster-sena-3.png',
    ]);
    expect(rig.download).toHaveBeenCalledTimes(1);
    expect(rig.download).toHaveBeenCalledWith(expect.objectContaining({ type: 'application/zip' }), 'senkutools-poster-sena.zip');
    expect(note()).toBe('');
  });

  it('reuses the bitmaps of the shown page and closes the ones it loaded for the others', async () => {
    const rig = createRig();
    await openReady(rig, cardsOf(SIXTY_ONE));
    rig.loadImage.mockClear();
    press('download-all');
    await settleLong();
    expect(rig.loadImage).toHaveBeenCalledTimes(40);
    expect(rig.closes.slice(0, 21).every((close) => close.mock.calls.length === 0)).toBe(true);
    expect(rig.closes.slice(21).every((close) => close.mock.calls.length === 1)).toBe(true);
    expect(rig.closes).toHaveLength(61);
  });

  it('renders the pages in order whichever page is shown', async () => {
    const rig = createRig();
    await openReady(rig, cardsOf(SIXTY_ONE));
    await goTo(rig, 'next');
    rig.loadImage.mockClear();
    press('download-all');
    await settleLong();
    expect(rig.render.mock.calls.slice(-3).map(([content]) => slugsOf(content))).toEqual([sliceOf(0, 21), sliceOf(21, 41), sliceOf(41, 61)]);
    expect(rig.loadImage).toHaveBeenCalledTimes(41);
  });

  it('says which page it is on while it renders', async () => {
    const seen: string[] = [];
    const rig = createRig();
    await openReady(rig, cardsOf(SIXTY_ONE));
    rig.render.mockImplementation(() => {
      seen.push(note());
      return Promise.resolve(new Blob(['png'], { type: 'image/png' }));
    });
    press('download-all');
    await settleLong();
    expect(seen).toEqual([POSTER_TEXT.archiving(1, 3), POSTER_TEXT.archiving(2, 3), POSTER_TEXT.archiving(3, 3)]);
  });

  it('keeps the settings of the click for every page even when they change meanwhile', async () => {
    const rig = createRig();
    await openReady(rig, cardsOf(SIXTY_ONE));
    rig.render.mockClear();
    rig.render.mockImplementation(() => {
      heading().value = 'Другое';
      return Promise.resolve(new Blob(['png'], { type: 'image/png' }));
    });
    heading().value = 'Меняю';
    press('download-all');
    await settleLong();
    expect(rig.render.mock.calls.map(([content]) => content.heading)).toEqual(['Меняю', 'Меняю', 'Меняю']);
  });
});

describe('download all state', () => {
  it('keeps the pager and the buttons off while the archive is built and frees them after', async () => {
    let finish: (blob: Blob) => void = () => undefined;
    const rig = createRig();
    await openReady(rig, cardsOf(SIXTY_ONE));
    rig.pack.mockImplementation(() => new Promise((resolve) => void (finish = resolve)));
    press('download-all');
    await settleLong();
    expect([isDisabled('.senkutools-poster__next'), isDisabled('.senkutools-poster__download-all')]).toEqual([true, true]);
    press('next');
    press('download-all');
    await settleLong();
    expect(rig.pack).toHaveBeenCalledTimes(1);
    expect(position()).toBe(POSTER_TEXT.position(1, 3));
    finish(new Blob(['zip'], { type: 'application/zip' }));
    await settleLong();
    expect([isDisabled('.senkutools-poster__next'), isDisabled('.senkutools-poster__download-all')]).toEqual([false, false]);
    expect(rig.download).toHaveBeenCalledTimes(1);
  });

  it('says the archive failed, downloads nothing and frees the controls when packing fails', async () => {
    const rig = createRig();
    await openReady(rig, cardsOf(SIXTY_ONE));
    rig.pack.mockRejectedValueOnce(new Error('no memory'));
    press('download-all');
    await settleLong();
    expect(note()).toBe(POSTER_TEXT.archiveFailed);
    expect(rig.download).not.toHaveBeenCalled();
    expect(isDisabled('.senkutools-poster__next')).toBe(false);
    expect(isDisabled('.senkutools-poster__download-all')).toBe(false);
  });

  it('says the archive failed and packs nothing when a page does not render', async () => {
    const rig = createRig();
    await openReady(rig, cardsOf(SIXTY_ONE));
    rig.render.mockRejectedValueOnce(new Error('canvas lost'));
    press('download-all');
    await settleLong();
    expect(rig.pack).not.toHaveBeenCalled();
    expect(note()).toBe(POSTER_TEXT.archiveFailed);
  });

  it('closes the bitmaps of a page that did not render', async () => {
    const rig = createRig();
    await openReady(rig, cardsOf(SIXTY_ONE));
    rig.render.mockResolvedValueOnce(new Blob(['one'], { type: 'image/png' }));
    rig.render.mockRejectedValueOnce(new Error('canvas lost'));
    press('download-all');
    await settleLong();
    expect(rig.closes.slice(21, 41).every((close) => close.mock.calls.length === 1)).toBe(true);
  });
});

describe('download all while closing or loading', () => {
  it('stops and downloads nothing when the dialog is closed during the archive', async () => {
    const rig = createRig();
    await openReady(rig, cardsOf(SIXTY_ONE));
    let finish: (blob: Blob) => void = () => undefined;
    rig.render.mockResolvedValueOnce(new Blob(['one'], { type: 'image/png' }));
    rig.render.mockImplementationOnce(() => new Promise((resolve) => void (finish = resolve)));
    press('download-all');
    await settleLong();
    closePosterDialogs(document);
    finish(new Blob(['two'], { type: 'image/png' }));
    await settleLong();
    expect(rig.render).toHaveBeenCalledTimes(3);
    expect(rig.pack).not.toHaveBeenCalled();
    expect(rig.download).not.toHaveBeenCalled();
    expect(rig.closes.slice(21, 41).every((close) => close.mock.calls.length === 1)).toBe(true);
  });

  it('downloads nothing when the dialog is closed while the archive is packed', async () => {
    const rig = createRig();
    await openReady(rig, cardsOf(SIXTY_ONE));
    let finish: (blob: Blob) => void = () => undefined;
    rig.pack.mockImplementation(() => new Promise((resolve) => void (finish = resolve)));
    press('download-all');
    await settleLong();
    closePosterDialogs(document);
    finish(new Blob(['zip'], { type: 'application/zip' }));
    await settleLong();
    expect(rig.download).not.toHaveBeenCalled();
  });

  it('does nothing before the first page is ready', async () => {
    let finish: (arts: Map<string, PosterArt>) => void = () => undefined;
    const fetchArt = vi.fn<PosterDialogHost['fetchArt']>(() => new Promise((resolve) => void (finish = resolve)));
    const rig = createRig({ fetchArt });
    openPosterDialog(cardsOf(SIXTY_ONE), 'sena', rig.host);
    await settle();
    press('download-all');
    await settleLong();
    expect(rig.pack).not.toHaveBeenCalled();
    finish(new Map());
    await settleLong();
  });
});

describe('file names with pages', () => {
  it('numbers a page with as many digits as the page count has', () => {
    expect(fileNameOf('sena', { number: 2, total: 3 })).toBe('senkutools-poster-sena-2.png');
    expect(fileNameOf('sena', { number: 2, total: 12 })).toBe('senkutools-poster-sena-02.png');
    expect(fileNameOf('sena', { number: 12, total: 12 })).toBe('senkutools-poster-sena-12.png');
  });

  it('names the archive after the profile like the png', () => {
    expect(archiveNameOf('sena')).toBe('senkutools-poster-sena.zip');
    expect(archiveNameOf('@24/94 x')).toBe('senkutools-poster-24-94-x.zip');
    expect(archiveNameOf('@@@')).toBe('senkutools-poster-poster.zip');
  });
});
