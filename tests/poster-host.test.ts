import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PosterArt } from '../utils/poster/poster-art';
import { copyImageBlob, createPosterDialogHost, downloadBlob, type PosterHostSources } from '../utils/poster/poster-host';
import * as render from '../utils/poster/poster-render';

const ART: PosterArt = { slug: 'alpha-s', rank: 'S', url: 'https://cdn.example/alpha-s.webp', width: 400, height: 600, isExplicit: false };

const sourcesOf = (): PosterHostSources => ({
  pageDocument: document,
  database: {},
  settings: { commission: true },
  fetchNickname: () => Promise.resolve(null),
  nextFrame: (run) => run(),
});

beforeEach(() => {
  document.body.innerHTML = '';
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('downloadBlob', () => {
  it('clicks a hidden link that carries the file name and the blob url, then removes it', () => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:poster-1');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const clicked: { href: string; download: string; hidden: boolean; isAttached: boolean }[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      clicked.push({ href: this.href, download: this.download, hidden: Boolean(this.hidden), isAttached: this.isConnected });
    });
    downloadBlob(document, new Blob(['png']), 'poster.png');
    expect(clicked).toEqual([{ href: 'blob:poster-1', download: 'poster.png', hidden: true, isAttached: true }]);
    expect(document.querySelector('a')).toBeNull();
  });

  it('revokes the blob url right after the click', () => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:poster-2');
    const order: string[] = [];
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation((url) => void order.push(`revoke ${url}`));
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => void order.push('click'));
    downloadBlob(document, new Blob(['png']), 'poster.png');
    expect(order).toEqual(['click', 'revoke blob:poster-2']);
  });
});

describe('copyImageBlob', () => {
  it('writes one clipboard item keyed by the type of the blob', async () => {
    class FakeClipboardItem {
      constructor(readonly items: Record<string, Blob>) {}
    }
    const write = vi.fn(() => Promise.resolve());
    vi.stubGlobal('ClipboardItem', FakeClipboardItem);
    vi.stubGlobal('navigator', { clipboard: { write } });
    const blob = new Blob(['png'], { type: 'image/png' });
    await copyImageBlob(blob);
    const items = (write.mock.calls[0] as unknown as [FakeClipboardItem[]])[0];
    expect(items).toHaveLength(1);
    expect(items[0]?.items).toEqual({ 'image/png': blob });
  });

  it('passes the refusal on', async () => {
    vi.stubGlobal('ClipboardItem', class {});
    vi.stubGlobal('navigator', { clipboard: { write: () => Promise.reject(new Error('denied')) } });
    await expect(copyImageBlob(new Blob(['png'], { type: 'image/png' }))).rejects.toThrow('denied');
  });
});

describe('createPosterDialogHost', () => {
  it('loads art with a cache-bypassing, credential-free fetch and decodes the body into a bitmap', async () => {
    const bitmap = { width: 400, height: 600, close: () => undefined } as ImageBitmap;
    const fetchMock = vi.fn(() => Promise.resolve(new Response(new Blob(['art']), { status: 200 })));
    const createBitmap = vi.fn(() => Promise.resolve(bitmap));
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('createImageBitmap', createBitmap);
    const host = createPosterDialogHost(sourcesOf());
    expect(await host.loadImage(ART)).toBe(bitmap);
    expect(fetchMock).toHaveBeenCalledWith(ART.url, { cache: 'reload', credentials: 'omit' });
    expect(createBitmap).toHaveBeenCalledTimes(1);
  });

  it('asks the API for the art with the signal it was given', async () => {
    const answer = { data: { card0: { rank: 'S', explicit: false, image: { original: { url: ART.url, width: 400, height: 600 } } } } };
    const fetchMock = vi.fn<typeof fetch>(() => Promise.resolve(new Response(JSON.stringify(answer), { status: 200 })));
    vi.stubGlobal('fetch', fetchMock);
    const controller = new AbortController();
    const arts = await createPosterDialogHost(sourcesOf()).fetchArt(['alpha-s'], controller.signal);
    expect(arts.get('alpha-s')?.url).toBe(ART.url);
    const requestBody = fetchMock.mock.calls[0]?.[1]?.body;
    const body = JSON.parse(typeof requestBody === 'string' ? requestBody : '{}') as { operationName: string };
    expect(body.operationName).toBe('PosterArt');
  });

  it('renders on a canvas of the requested size with the theme read from the page', async () => {
    const theme = { background: '#111', surface: '#222', text: '#fff', mutedText: '#aaa', shadow: '#000', fontFamily: 'Inter' };
    vi.spyOn(render, 'readPosterTheme').mockReturnValue(theme);
    const blob = new Blob(['png'], { type: 'image/png' });
    const renderPoster = vi.spyOn(render, 'renderPoster').mockResolvedValue(blob);
    const content = { cards: [], heading: '', nickname: null, shouldShowQuantity: true };
    expect(await createPosterDialogHost(sourcesOf()).render(content)).toBe(blob);
    const [passedContent, passedTheme, renderHost] = renderPoster.mock.calls[0] ?? [];
    expect(passedContent).toBe(content);
    expect(passedTheme).toBe(theme);
    const canvas = renderHost?.createCanvas(640, 480);
    expect([canvas?.tagName, canvas?.width, canvas?.height]).toEqual(['CANVAS', 640, 480]);
  });

  it('hands the sources it was given to the dialog unchanged', () => {
    const sources = sourcesOf();
    const host = createPosterDialogHost(sources);
    expect([host.pageDocument, host.database, host.settings, host.nextFrame, host.fetchNickname]).toEqual([
      sources.pageDocument,
      sources.database,
      sources.settings,
      sources.nextFrame,
      sources.fetchNickname,
    ]);
  });
});
