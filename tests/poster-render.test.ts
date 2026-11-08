import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CAPTION_HEIGHT_PX, POSTER_MARGIN_PX, POSTER_CARDS_PER_PAGE, layoutPoster, type PosterLayoutOptions } from '../utils/poster/poster-layout';
import { readPosterTheme, renderPoster, type PosterCardContent, type PosterContent, type PosterTheme, type RenderHost } from '../utils/poster/poster-render';
import { SHARD_CRACKS, SHARD_DARK_STROKE, SHARD_LIGHT_STROKE, SHARD_STROKE_RATIO, parseCrackPoints, rankOfCard } from '../utils/poster/poster-shards';

const THEME: PosterTheme = { background: '#111', surface: '#222', text: '#eee', mutedText: '#999', shadow: '#000', fontFamily: 'Inter, sans-serif' };
const POSTER_BLOB = new Blob(['poster'], { type: 'image/png' });
const PNG_TYPE = 'image/png';
const CARD_RADIUS_RATIO = 0.088;
const HEADING_FONT = `700 64px ${THEME.fontFamily}`;
const CAPTION_FONT = `600 28px ${THEME.fontFamily}`;
const FOOTER_FONT = `500 32px ${THEME.fontFamily}`;
const PLACEHOLDER_FONT_RATIO = 0.3;
const SHADOW_BLUR_PX = 24;
const SHADOW_OFFSET_Y_PX = 8;
const PLAIN: PosterLayoutOptions = { hasHeading: false, hasFooter: false, hasCaptions: false };
const CAPTIONED: PosterLayoutOptions = { hasHeading: false, hasFooter: false, hasCaptions: true };

const DRAWING_METHODS = ['save', 'restore', 'beginPath', 'roundRect', 'clip', 'fill', 'fillRect', 'drawImage', 'fillText', 'moveTo', 'lineTo', 'stroke'];
const DRAWING_PROPERTIES = [
  'fillStyle',
  'strokeStyle',
  'lineWidth',
  'lineCap',
  'lineJoin',
  'font',
  'textAlign',
  'textBaseline',
  'shadowColor',
  'shadowBlur',
  'shadowOffsetX',
  'shadowOffsetY',
  'imageSmoothingEnabled',
  'imageSmoothingQuality',
];
const PAINTING_METHODS = ['fill', 'fillRect', 'drawImage', 'fillText', 'stroke'];

interface DrawingCall {
  name: string;
  operands: unknown[];
  state: Readonly<Record<string, unknown>>;
}

interface CanvasSize {
  width: number;
  height: number;
}

function recordingDrawing() {
  const calls: DrawingCall[] = [];
  const savedStates: Record<string, unknown>[] = [];
  let state: Record<string, unknown> = {};
  const record = (name: string, operands: unknown[]): void => {
    calls.push({ name, operands, state: { ...state } });
    if (name === 'save') savedStates.push({ ...state });
    if (name === 'restore') state = savedStates.pop() ?? state;
  };
  const drawing = new Proxy(
    {},
    {
      get: (_target, name) => {
        if (typeof name === 'string' && DRAWING_METHODS.includes(name)) return (...operands: unknown[]) => record(name, operands);
        if (typeof name === 'string' && DRAWING_PROPERTIES.includes(name)) return state[name];
        throw new Error(`the recording 2D context has no ${String(name)}`);
      },
      set: (_target, name, assigned) => {
        if (typeof name !== 'string' || !DRAWING_PROPERTIES.includes(name)) throw new Error(`the recording 2D context has no property ${String(name)}`);
        state[name] = assigned;
        return true;
      },
    }
  ) as CanvasRenderingContext2D;
  return { drawing, calls };
}

function fakeCanvasHost(drawing: CanvasRenderingContext2D | null, blob: Blob | null = POSTER_BLOB) {
  const sizes: CanvasSize[] = [];
  const requestedTypes: (string | undefined)[] = [];
  const host: RenderHost = {
    createCanvas: (width, height) => {
      sizes.push({ width, height });
      const canvas = {
        width,
        height,
        getContext: (contextId: string) => (contextId === '2d' ? drawing : null),
        toBlob: (deliver: BlobCallback, type?: string) => {
          requestedTypes.push(type);
          setTimeout(() => deliver(blob), 0);
        },
      };
      return canvas as unknown as HTMLCanvasElement;
    },
  };
  return { host, sizes, requestedTypes };
}

const cardOf = (index: number, quantity = 1, priceText: string | null = null): PosterCardContent => ({
  selected: { slug: `card-${index}`, quantity },
  image: document.createElement('img'),
  priceText,
});

const missingArtOf = (index: number): PosterCardContent => ({ ...cardOf(index), image: null });

const cardsOf = (count: number): PosterCardContent[] => Array.from({ length: count }, (_, index) => cardOf(index));

const contentOf = (cards: readonly PosterCardContent[], overrides: Partial<PosterContent> = {}): PosterContent => ({
  cards,
  heading: '',
  nickname: null,
  shouldShowQuantity: true,
  ...overrides,
});

async function render(content: PosterContent) {
  const { drawing, calls } = recordingDrawing();
  const canvas = fakeCanvasHost(drawing);
  const blob = await renderPoster(content, THEME, canvas.host);
  return { calls, blob, sizes: canvas.sizes, requestedTypes: canvas.requestedTypes };
}

const callsNamed = (calls: readonly DrawingCall[], name: string): DrawingCall[] => calls.filter((call) => call.name === name);

const textsOf = (calls: readonly DrawingCall[]): unknown[] => callsNamed(calls, 'fillText').map((call) => call.operands[0]);

const textCall = (calls: readonly DrawingCall[], text: string): DrawingCall => {
  const call = callsNamed(calls, 'fillText').find((candidate) => candidate.operands[0] === text);
  if (!call) throw new Error(`no text ${text} was drawn`);
  return call;
};

const cellAt = (options: PosterLayoutOptions, count: number, index: number) => {
  const cell = layoutPoster(count, options).cells[index];
  if (!cell) throw new Error(`the layout of ${count} cards has no cell ${index}`);
  return cell;
};

beforeEach(() => {
  document.documentElement.removeAttribute('style');
  document.body.removeAttribute('style');
  document.head.innerHTML = '';
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('renderPoster', () => {
  it('draws each art once, exactly into its layout cell', async () => {
    const cards = cardsOf(5);
    const { calls } = await render(contentOf(cards));
    const { cells } = layoutPoster(cards.length, PLAIN);
    const draws = callsNamed(calls, 'drawImage');
    expect(draws).toHaveLength(cards.length);
    cells.forEach((cell, index) => {
      expect(draws[index]?.operands).toEqual([cards[index]?.image, cell.x, cell.y, cell.width, cell.height]);
    });
  });

  it('draws a question mark on a surface placeholder instead of a missing art', async () => {
    const cards = [cardOf(0), missingArtOf(1), cardOf(2)];
    const { calls } = await render(contentOf(cards));
    const cell = cellAt(PLAIN, cards.length, 1);
    const draws = callsNamed(calls, 'drawImage');
    expect(draws.map((call) => call.operands[0])).toEqual([cards[0]?.image, cards[2]?.image]);
    const mark = textCall(calls, '?');
    expect(mark.operands.slice(1, 3)).toEqual([cell.x + cell.width / 2, cell.y + cell.height / 2]);
    expect(mark.state).toMatchObject({ fillStyle: THEME.mutedText, font: `700 ${Math.round(cell.width * PLACEHOLDER_FONT_RATIO)}px ${THEME.fontFamily}` });
    const placeholderIndex = calls.findIndex((call) => call.name === 'roundRect' && call.operands[0] === cell.x && call.operands[1] === cell.y);
    const placeholderFill = calls.slice(placeholderIndex).find((call) => call.name === 'fill');
    expect(placeholderFill?.state.fillStyle).toBe(THEME.surface);
  });

  it('never draws more images than cards with art, so no frame layer is stacked on top', async () => {
    const cards = [cardOf(0), cardOf(1), missingArtOf(2), cardOf(3)];
    const { calls } = await render(contentOf(cards, { heading: 'Коллекция', nickname: 'chu' }));
    expect(callsNamed(calls, 'drawImage')).toHaveLength(3);
  });

  it('paints the whole canvas with the background before anything else', async () => {
    const { calls, sizes } = await render(contentOf(cardsOf(2), { heading: 'Коллекция' }));
    const firstPaint = calls.find((call) => PAINTING_METHODS.includes(call.name));
    expect(firstPaint?.name).toBe('fillRect');
    expect(firstPaint?.operands).toEqual([0, 0, sizes[0]?.width, sizes[0]?.height]);
    expect(firstPaint?.state.fillStyle).toBe(THEME.background);
  });

  it('draws the trimmed heading in bold, centred in the heading band and kept inside the margins', async () => {
    const { calls } = await render(contentOf(cardsOf(2), { heading: '  Моя коллекция  ' }));
    const layout = layoutPoster(2, { ...PLAIN, hasHeading: true });
    const heading = textCall(calls, 'Моя коллекция');
    expect(heading.operands.slice(1)).toEqual([layout.width / 2, POSTER_MARGIN_PX + layout.headerHeight / 2, layout.width - 2 * POSTER_MARGIN_PX]);
    expect(heading.state).toMatchObject({ fillStyle: THEME.text, font: HEADING_FONT, textAlign: 'center', textBaseline: 'middle' });
  });

  it('draws no heading and leaves no heading band when the heading is empty or only spaces', async () => {
    for (const heading of ['', '   ']) {
      const { calls, sizes } = await render(contentOf(cardsOf(2), { heading }));
      expect(textsOf(calls)).toEqual([]);
      expect(sizes[0]?.height).toBe(layoutPoster(2, PLAIN).height);
    }
  });

  it('draws the trimmed nickname muted and centred in the footer band', async () => {
    const { calls } = await render(contentOf(cardsOf(2), { nickname: ' chu ' }));
    const layout = layoutPoster(2, { ...PLAIN, hasFooter: true });
    const nickname = textCall(calls, 'chu');
    expect(nickname.operands.slice(1)).toEqual([
      layout.width / 2,
      layout.height - POSTER_MARGIN_PX - layout.footerHeight / 2,
      layout.width - 2 * POSTER_MARGIN_PX,
    ]);
    expect(nickname.state).toMatchObject({ fillStyle: THEME.mutedText, font: FOOTER_FONT, textAlign: 'center', textBaseline: 'middle' });
  });

  it('draws no nickname and leaves no footer band when the nickname is null or blank', async () => {
    for (const nickname of [null, '', '  ']) {
      const { calls, sizes } = await render(contentOf(cardsOf(2), { nickname }));
      expect(textsOf(calls)).toEqual([]);
      expect(sizes[0]?.height).toBe(layoutPoster(2, PLAIN).height);
    }
  });

  it('captions a card held three times with ×3 centred in its caption strip and no wider than the card', async () => {
    const cards = [cardOf(0, 3)];
    const { calls, sizes } = await render(contentOf(cards));
    const cell = cellAt(CAPTIONED, 1, 0);
    const caption = textCall(calls, '×3');
    expect(caption.operands.slice(1)).toEqual([cell.x + cell.width / 2, cell.captionY + CAPTION_HEIGHT_PX / 2, cell.width]);
    expect(caption.state).toMatchObject({ fillStyle: THEME.text, font: CAPTION_FONT, textAlign: 'center', textBaseline: 'middle' });
    expect(sizes[0]?.height).toBe(layoutPoster(1, CAPTIONED).height);
  });

  it('leaves a single copy without a price uncaptioned', async () => {
    const { calls, sizes } = await render(contentOf([cardOf(0, 1)]));
    expect(textsOf(calls)).toEqual([]);
    expect(sizes[0]?.height).toBe(layoutPoster(1, PLAIN).height);
  });

  it('drops the quantity caption when quantities are hidden', async () => {
    const { calls, sizes } = await render(contentOf([cardOf(0, 3)], { shouldShowQuantity: false }));
    expect(textsOf(calls)).toEqual([]);
    expect(sizes[0]?.height).toBe(layoutPoster(1, PLAIN).height);
  });

  it('joins the quantity and the price with a middle dot', async () => {
    const { calls } = await render(contentOf([cardOf(0, 2, '12.50')]));
    expect(textsOf(calls)).toEqual(['×2 · 12.50']);
  });

  it('captions the price alone for a single copy or when quantities are hidden', async () => {
    expect(textsOf((await render(contentOf([cardOf(0, 1, '12.50')]))).calls)).toEqual(['12.50']);
    expect(textsOf((await render(contentOf([cardOf(0, 4, '12.50')], { shouldShowQuantity: false }))).calls)).toEqual(['12.50']);
  });

  it('adds no caption part for an empty price text', async () => {
    expect(textsOf((await render(contentOf([cardOf(0, 2, '')]))).calls)).toEqual(['×2']);
    const { calls, sizes } = await render(contentOf([cardOf(0, 1, '')]));
    expect(textsOf(calls)).toEqual([]);
    expect(sizes[0]?.height).toBe(layoutPoster(1, PLAIN).height);
  });

  it('reserves the caption strip for every card once one card has a caption', async () => {
    const cards = [cardOf(0), cardOf(1, 2), cardOf(2)];
    const { calls, sizes } = await render(contentOf(cards));
    const layout = layoutPoster(cards.length, CAPTIONED);
    expect(sizes[0]).toEqual({ width: layout.width, height: layout.height });
    expect(textsOf(calls)).toEqual(['×2']);
    expect(callsNamed(calls, 'drawImage').map((call) => call.operands[2])).toEqual(layout.cells.map((cell) => cell.y));
  });

  it('sizes the canvas to the layout for one, three and thirty-one cards, drawing at most thirty', async () => {
    for (const count of [1, 3, POSTER_CARDS_PER_PAGE + 1]) {
      const { calls, sizes } = await render(contentOf(cardsOf(count), { heading: 'Коллекция' }));
      const layout = layoutPoster(Math.min(count, POSTER_CARDS_PER_PAGE), { ...PLAIN, hasHeading: true });
      expect(sizes).toEqual([{ width: layout.width, height: layout.height }]);
      expect(callsNamed(calls, 'drawImage')).toHaveLength(Math.min(count, POSTER_CARDS_PER_PAGE));
    }
  });

  it('ignores the caption of a card past the poster limit', async () => {
    const cards = [...cardsOf(POSTER_CARDS_PER_PAGE), cardOf(POSTER_CARDS_PER_PAGE, 5, '9.00')];
    const { calls, sizes } = await render(contentOf(cards));
    expect(textsOf(calls)).toEqual([]);
    expect(sizes[0]?.height).toBe(layoutPoster(POSTER_CARDS_PER_PAGE, PLAIN).height);
  });

  it('rounds every card to 8.8 percent of its width', async () => {
    for (const count of [1, 7]) {
      const { calls } = await render(contentOf([...cardsOf(count - 1), missingArtOf(count)]));
      const { cells } = layoutPoster(count, PLAIN);
      const roundRects = callsNamed(calls, 'roundRect');
      expect(roundRects.length).toBeGreaterThanOrEqual(count);
      for (const roundRect of roundRects) {
        const cell = cells.find((candidate) => candidate.x === roundRect.operands[0] && candidate.y === roundRect.operands[1]);
        expect(roundRect.operands).toEqual([cell?.x, cell?.y, cell?.width, cell?.height, Math.round((cell?.width ?? 0) * CARD_RADIUS_RATIO)]);
      }
    }
  });

  it('draws each art in high quality inside a rounded clip of its own saved state', async () => {
    const { calls } = await render(contentOf(cardsOf(3)));
    expect(callsNamed(calls, 'drawImage')).toHaveLength(3);
    calls.forEach((call, index) => {
      if (call.name !== 'drawImage') return;
      const saveIndex = calls.slice(0, index).findLastIndex((candidate) => candidate.name === 'save');
      expect(calls.slice(saveIndex, index + 2).map((candidate) => candidate.name)).toEqual(['save', 'beginPath', 'roundRect', 'clip', 'drawImage', 'restore']);
      expect(call.state.imageSmoothingQuality).toBe('high');
    });
    expect(callsNamed(calls, 'save')).toHaveLength(callsNamed(calls, 'restore').length);
  });

  it('casts a soft shadow from a surface fill under every card and none over the art', async () => {
    const cards = [cardOf(0), missingArtOf(1)];
    const { calls } = await render(contentOf(cards));
    const shadowFills = callsNamed(calls, 'fill').filter((call) => call.state.shadowColor === THEME.shadow);
    expect(shadowFills).toHaveLength(cards.length);
    const shadowState = { fillStyle: THEME.surface, shadowBlur: SHADOW_BLUR_PX, shadowOffsetY: SHADOW_OFFSET_Y_PX };
    for (const fill of shadowFills) expect(fill.state).toMatchObject(shadowState);
    for (const draw of callsNamed(calls, 'drawImage')) expect(draw.state.shadowColor).toBeUndefined();
  });

  it('refuses a poster without cards', async () => {
    const { drawing } = recordingDrawing();
    const canvas = fakeCanvasHost(drawing);
    await expect(renderPoster(contentOf([]), THEME, canvas.host)).rejects.toThrow(Error);
    expect(canvas.sizes).toEqual([]);
  });

  it('refuses when the canvas has no 2D context', async () => {
    await expect(renderPoster(contentOf(cardsOf(1)), THEME, fakeCanvasHost(null).host)).rejects.toThrow(/2D context/);
  });

  it('refuses when the canvas yields no image', async () => {
    const { drawing } = recordingDrawing();
    await expect(renderPoster(contentOf(cardsOf(1)), THEME, fakeCanvasHost(drawing, null).host)).rejects.toThrow(/no image/);
  });

  it('resolves with the PNG the canvas produced', async () => {
    const { blob, requestedTypes } = await render(contentOf(cardsOf(1)));
    expect(blob).toBe(POSTER_BLOB);
    expect(requestedTypes).toEqual([PNG_TYPE]);
  });

  it('draws the full uncut card art and overlays the light and dark shard crack strokes inside the card clip', async () => {
    const shardCard: PosterCardContent = {
      selected: { slug: 'alpha-r', quantity: 3, shard: true },
      image: document.createElement('img'),
      priceText: '4.50',
      rank: 'R',
    };
    const { calls } = await render(contentOf([shardCard]));
    const cell = cellAt(CAPTIONED, 1, 0);
    expect(callsNamed(calls, 'drawImage')[0]?.operands).toEqual([shardCard.image, cell.x, cell.y, cell.width, cell.height]);
    const strokes = callsNamed(calls, 'stroke');
    expect(strokes).toHaveLength(2);
    expect(strokes.map((call) => call.state.strokeStyle)).toEqual([SHARD_LIGHT_STROKE, SHARD_DARK_STROKE]);
    for (const stroke of strokes) {
      expect(stroke.state).toMatchObject({
        lineWidth: cell.width * SHARD_STROKE_RATIO,
        lineCap: 'square',
        lineJoin: 'miter',
      });
    }
    expect(textsOf(calls)).toEqual(['×3 · 4.50']);
  });

  it('infers the shard rank from the slug or falls back to D when rank is omitted', async () => {
    const dShard: PosterCardContent = {
      selected: { slug: 'bronze-d', quantity: 1, shard: true },
      image: document.createElement('img'),
      priceText: null,
    };
    const { calls } = await render(contentOf([dShard]));
    expect(callsNamed(calls, 'stroke')).toHaveLength(2);
    expect(rankOfCard(undefined, 'hero-s')).toBe('S');
    expect(rankOfCard('f', 'hero-f')).toBe('D');
    expect(rankOfCard(undefined, 'unknown')).toBe('D');
    for (const paths of Object.values(SHARD_CRACKS)) {
      for (const pathData of paths) expect(parseCrackPoints(pathData).length).toBeGreaterThanOrEqual(2);
    }
    expect(parseCrackPoints('')).toEqual([]);
  });
});

describe('readPosterTheme', () => {
  it('reads every poster colour from the root element, trimmed', () => {
    const root = document.documentElement.style;
    root.setProperty('--senkutools-poster-background', ' #101010 ');
    root.setProperty('--senkutools-poster-surface', ' #202020 ');
    root.setProperty('--senkutools-poster-text', ' #fff ');
    root.setProperty('--senkutools-poster-muted-text', ' #aaa ');
    root.setProperty('--senkutools-poster-shadow', ' rgb(0 0 0 / 0.5) ');
    expect(readPosterTheme(document)).toMatchObject({
      background: '#101010',
      surface: '#202020',
      text: '#fff',
      mutedText: '#aaa',
      shadow: 'rgb(0 0 0 / 0.5)',
    });
  });

  it('reads a missing colour token as an empty string', () => {
    document.documentElement.style.setProperty('--senkutools-poster-text', '#fff');
    expect(readPosterTheme(document)).toMatchObject({ background: '', surface: '', text: '#fff', mutedText: '', shadow: '' });
  });

  it('trims the spaces a browser keeps around a custom property and reads a lone space as empty', () => {
    const paddedValues: Readonly<Record<string, string>> = { '--senkutools-poster-text': ' #fff ', '--senkutools-poster-shadow': ' ' };
    const browserStyle = { getPropertyValue: (property: string) => paddedValues[property] ?? '', fontFamily: 'Inter' };
    vi.spyOn(globalThis, 'getComputedStyle').mockReturnValue(browserStyle as unknown as CSSStyleDeclaration);
    expect(readPosterTheme(document)).toMatchObject({ text: '#fff', shadow: '' });
  });

  it('takes the font family from the body', () => {
    document.body.style.fontFamily = 'Inter, sans-serif';
    expect(readPosterTheme(document).fontFamily).toBe('Inter, sans-serif');
  });

  it('finds a value for every poster colour in the shipped tokens', () => {
    const tokens = document.createElement('style');
    tokens.textContent = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../assets/tokens.css'), 'utf8');
    document.head.append(tokens);
    const theme = readPosterTheme(document);
    for (const colour of [theme.background, theme.surface, theme.text, theme.mutedText, theme.shadow]) expect(colour).not.toBe('');
  });
});
