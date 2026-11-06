import { describe, expect, it } from 'vitest';

import {
  CAPTION_GAP_PX,
  CAPTION_HEIGHT_PX,
  CARD_SOURCE_HEIGHT_PX,
  CARD_SOURCE_WIDTH_PX,
  FOOTER_HEIGHT_PX,
  HEADING_HEIGHT_PX,
  POSTER_MARGIN_PX,
  POSTER_CARDS_PER_PAGE,
  POSTER_MAX_WIDTH_PX,
  layoutPoster,
  type PosterCell,
  type PosterLayout,
  type PosterLayoutOptions,
} from '../utils/poster/poster-layout';

const TOLERANCE_PX = 1;
const LARGEST_CARD_WIDTH_PX = 600;
const COLUMNS_BY_COUNT: Readonly<Record<number, number>> = { 1: 1, 2: 2, 3: 3, 4: 2, 5: 3, 6: 3, 7: 4, 8: 4, 9: 3, 12: 4 };
const FEWEST_LARGE_COLUMNS = 4;
const MOST_LARGE_COLUMNS = 6;
const SMALL_POSTER_CARDS_PER_PAGE = 12;
const INCOMPLETE_ROW_COUNTS = [5, 7, 11];

const FLAG_COMBINATIONS: PosterLayoutOptions[] = [false, true].flatMap((hasHeading) =>
  [false, true].flatMap((hasFooter) => [false, true].map((hasCaptions) => ({ hasHeading, hasFooter, hasCaptions })))
);
const PLAIN: PosterLayoutOptions = { hasHeading: false, hasFooter: false, hasCaptions: false };
const DECORATED: PosterLayoutOptions = { hasHeading: true, hasFooter: true, hasCaptions: true };
const EVERY_COUNT = Array.from({ length: POSTER_CARDS_PER_PAGE }, (_, index) => index + 1);

interface LaidOut {
  count: number;
  options: PosterLayoutOptions;
  layout: PosterLayout;
}

const layoutsOf = (counts: readonly number[]): LaidOut[] =>
  counts.flatMap((count) => FLAG_COMBINATIONS.map((options) => ({ count, options, layout: layoutPoster(count, options) })));

const bottomOf = (cell: PosterCell, options: PosterLayoutOptions): number => cell.captionY + (options.hasCaptions ? CAPTION_HEIGHT_PX : 0);

const rowsOf = (layout: PosterLayout): PosterCell[][] =>
  Array.from({ length: layout.rows }, (_, index) => layout.cells.slice(index * layout.columns, (index + 1) * layout.columns));

const midlineOffsetOf = (row: PosterCell[], layout: PosterLayout): number => {
  const first = row[0];
  const last = row[row.length - 1];
  if (!first || !last) throw new Error('a row holds no cells');
  return Math.abs((first.x + last.x + last.width) / 2 - layout.width / 2);
};

const doOverlap = (a: PosterCell, b: PosterCell, options: PosterLayoutOptions): boolean =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < bottomOf(b, options) && b.y < bottomOf(a, options);

describe('layoutPoster', () => {
  it('lays out one cell per card up to the poster limit for every count and option', () => {
    for (const { count, layout } of layoutsOf(EVERY_COUNT)) expect(layout.cells).toHaveLength(Math.min(count, POSTER_CARDS_PER_PAGE));
  });

  it('keeps only the first thirty cards when more are selected', () => {
    for (const count of [POSTER_CARDS_PER_PAGE + 1, 100]) {
      for (const options of FLAG_COMBINATIONS) expect(layoutPoster(count, options).cells).toHaveLength(POSTER_CARDS_PER_PAGE);
    }
  });

  it('keeps every card inside the margins, below the heading band and above the footer band', () => {
    for (const { options, layout } of layoutsOf(EVERY_COUNT)) {
      for (const cell of layout.cells) {
        expect(cell.x).toBeGreaterThanOrEqual(POSTER_MARGIN_PX);
        expect(cell.x + cell.width).toBeLessThanOrEqual(layout.width - POSTER_MARGIN_PX);
        expect(cell.y).toBeGreaterThanOrEqual(POSTER_MARGIN_PX + layout.headerHeight);
        expect(bottomOf(cell, options)).toBeLessThanOrEqual(layout.height - POSTER_MARGIN_PX - layout.footerHeight);
      }
    }
  });

  it('never lets two cards or their captions overlap', () => {
    for (const { options, layout } of layoutsOf(EVERY_COUNT)) {
      layout.cells.forEach((cell, index) => {
        for (const other of layout.cells.slice(index + 1)) expect(doOverlap(cell, other, options)).toBe(false);
      });
    }
  });

  it('draws every card in the two to three shape of the source art', () => {
    for (const { layout } of layoutsOf(EVERY_COUNT)) {
      for (const cell of layout.cells) {
        expect(Math.abs(cell.height - (cell.width * CARD_SOURCE_HEIGHT_PX) / CARD_SOURCE_WIDTH_PX)).toBeLessThanOrEqual(TOLERANCE_PX);
      }
    }
  });

  it('never grows the poster past its widest size or a card past one and a half times its source', () => {
    for (const { layout } of layoutsOf(EVERY_COUNT)) {
      expect(layout.width).toBeLessThanOrEqual(POSTER_MAX_WIDTH_PX);
      for (const cell of layout.cells) expect(cell.width).toBeLessThanOrEqual(LARGEST_CARD_WIDTH_PX);
    }
  });

  it('makes a card as wide as the poster width allows unless the card is at its largest', () => {
    for (const { layout } of layoutsOf(EVERY_COUNT)) {
      const first = layout.cells[0];
      if (!first || layout.columns < 2 || first.width >= LARGEST_CARD_WIDTH_PX) continue;
      expect(layout.width + layout.columns).toBeGreaterThan(POSTER_MAX_WIDTH_PX);
    }
  });

  it('ends the canvas one margin and the footer band below the last card or caption', () => {
    for (const { options, layout } of layoutsOf(EVERY_COUNT)) {
      const last = layout.cells.at(-1);
      if (!last) throw new Error('the layout holds no cells');
      expect(layout.height).toBe(bottomOf(last, options) + POSTER_MARGIN_PX + layout.footerHeight);
    }
  });

  it('centres an incomplete last row on the vertical midline', () => {
    for (const { layout } of layoutsOf(INCOMPLETE_ROW_COUNTS)) {
      const lastRow = rowsOf(layout).at(-1) ?? [];
      expect(lastRow.length).toBeLessThan(layout.columns);
      expect(midlineOffsetOf(lastRow, layout)).toBeLessThanOrEqual(TOLERANCE_PX);
    }
  });

  it('centres every row of the grid, a single card on the narrowest poster included', () => {
    for (const { layout } of layoutsOf(EVERY_COUNT)) {
      for (const row of rowsOf(layout)) expect(midlineOffsetOf(row, layout)).toBeLessThanOrEqual(TOLERANCE_PX);
    }
  });

  it('places the cells in reading order, row by row and left to right', () => {
    for (const { count, options, layout } of layoutsOf(EVERY_COUNT)) {
      expect(layout.rows).toBe(Math.ceil(count / layout.columns));
      layout.cells.forEach((cell, index) => {
        const rowStart = layout.cells[index - (index % layout.columns)];
        const previous = layout.cells[index - 1];
        expect(cell.y).toBe(rowStart?.y);
        if (!previous) return;
        if (index % layout.columns === 0) expect(cell.y).toBeGreaterThan(bottomOf(previous, options));
        else expect(cell.x).toBeGreaterThan(previous.x + previous.width);
      });
    }
  });

  it('picks the pinned column count for small posters, plain and fully decorated', () => {
    for (const [count, columns] of Object.entries(COLUMNS_BY_COUNT)) {
      expect(layoutPoster(Number(count), PLAIN).columns).toBe(columns);
      expect(layoutPoster(Number(count), DECORATED).columns).toBe(columns);
    }
  });

  it('uses four to six columns for more than twelve cards', () => {
    const largeCounts = EVERY_COUNT.filter((count) => count > SMALL_POSTER_CARDS_PER_PAGE);
    for (const { layout } of layoutsOf(largeCounts)) {
      expect(layout.columns).toBeGreaterThanOrEqual(FEWEST_LARGE_COLUMNS);
      expect(layout.columns).toBeLessThanOrEqual(MOST_LARGE_COLUMNS);
    }
  });

  it('starts the caption strip a gap below the card when captions are on and at its bottom edge when off', () => {
    for (const { options, layout } of layoutsOf(EVERY_COUNT)) {
      for (const cell of layout.cells) expect(cell.captionY).toBe(cell.y + cell.height + (options.hasCaptions ? CAPTION_GAP_PX : 0));
    }
  });

  it('gives the heading and footer bands their height only when they are on', () => {
    for (const options of FLAG_COMBINATIONS) {
      const layout = layoutPoster(1, options);
      expect(layout.headerHeight).toBe(options.hasHeading ? HEADING_HEIGHT_PX : 0);
      expect(layout.footerHeight).toBe(options.hasFooter ? FOOTER_HEIGHT_PX : 0);
    }
  });

  it('refuses a count below one or a count that is not a whole number', () => {
    expect(() => layoutPoster(0, PLAIN)).toThrow(RangeError);
    expect(() => layoutPoster(1.5, PLAIN)).toThrow(RangeError);
  });
});
