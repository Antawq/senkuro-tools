export const CARD_SOURCE_WIDTH_PX = 400;
export const CARD_SOURCE_HEIGHT_PX = 600;
export const POSTER_MAX_CARDS = 30;
export const POSTER_MAX_WIDTH_PX = 1600;
export const POSTER_MARGIN_PX = 48;
export const HEADING_HEIGHT_PX = 140;
export const FOOTER_HEIGHT_PX = 80;
export const CAPTION_GAP_PX = 12;
export const CAPTION_HEIGHT_PX = 40;

const POSTER_MIN_WIDTH_PX = 720;
const POSTER_GAP_PX = 24;
const POSTER_MAX_COLUMNS = 6;
const UPSCALE_LIMIT = 1.5;
const CARD_MAX_WIDTH_PX = Math.floor(CARD_SOURCE_WIDTH_PX * UPSCALE_LIMIT);
const TARGET_ASPECT = 0.9;
const INCOMPLETE_ROW_PENALTY = 1.5;

export interface PosterLayoutOptions {
  hasHeading: boolean;
  hasFooter: boolean;
  hasCaptions: boolean;
}

export interface PosterCell {
  x: number;
  y: number;
  width: number;
  height: number;
  captionY: number;
}

export interface PosterLayout {
  width: number;
  height: number;
  headerHeight: number;
  footerHeight: number;
  columns: number;
  rows: number;
  cells: PosterCell[];
}

interface PosterGrid {
  columns: number;
  rows: number;
  cardWidth: number;
  cardHeight: number;
  rowHeight: number;
  width: number;
  height: number;
  headerHeight: number;
  footerHeight: number;
}

const spanOf = (count: number, sizePx: number): number => count * sizePx + (count - 1) * POSTER_GAP_PX;

const cardWidthFor = (columns: number): number =>
  Math.min(CARD_MAX_WIDTH_PX, Math.floor((POSTER_MAX_WIDTH_PX - 2 * POSTER_MARGIN_PX - (columns - 1) * POSTER_GAP_PX) / columns));

function gridOf(count: number, columns: number, options: PosterLayoutOptions): PosterGrid {
  const cardWidth = cardWidthFor(columns);
  const cardHeight = Math.round((cardWidth * CARD_SOURCE_HEIGHT_PX) / CARD_SOURCE_WIDTH_PX);
  const rows = Math.ceil(count / columns);
  const rowHeight = cardHeight + (options.hasCaptions ? CAPTION_GAP_PX + CAPTION_HEIGHT_PX : 0);
  const headerHeight = options.hasHeading ? HEADING_HEIGHT_PX : 0;
  const footerHeight = options.hasFooter ? FOOTER_HEIGHT_PX : 0;
  const width = Math.max(POSTER_MIN_WIDTH_PX, spanOf(columns, cardWidth) + 2 * POSTER_MARGIN_PX);
  const height = 2 * POSTER_MARGIN_PX + headerHeight + spanOf(rows, rowHeight) + footerHeight;
  return { columns, rows, cardWidth, cardHeight, rowHeight, width, height, headerHeight, footerHeight };
}

const scoreOf = (grid: PosterGrid, count: number): number =>
  Math.abs(Math.log(grid.width / grid.height) - Math.log(TARGET_ASPECT)) + (INCOMPLETE_ROW_PENALTY * (grid.rows * grid.columns - count)) / grid.columns;

function bestGridOf(count: number, options: PosterLayoutOptions): PosterGrid {
  let best = gridOf(count, 1, options);
  let bestScore = scoreOf(best, count);
  for (let columns = 2; columns <= Math.min(count, POSTER_MAX_COLUMNS); columns++) {
    const grid = gridOf(count, columns, options);
    const score = scoreOf(grid, count);
    if (score < bestScore || (score === bestScore && grid.rows < best.rows)) {
      best = grid;
      bestScore = score;
    }
  }
  return best;
}

function cellsOf(count: number, grid: PosterGrid, options: PosterLayoutOptions): PosterCell[] {
  const top = POSTER_MARGIN_PX + grid.headerHeight;
  const captionOffset = options.hasCaptions ? CAPTION_GAP_PX : 0;
  return Array.from({ length: count }, (_, index) => {
    const row = Math.floor(index / grid.columns);
    const column = index % grid.columns;
    const rowCardCount = Math.min(grid.columns, count - row * grid.columns);
    const rowLeft = Math.round((grid.width - spanOf(rowCardCount, grid.cardWidth)) / 2);
    const x = rowLeft + column * (grid.cardWidth + POSTER_GAP_PX);
    const y = top + row * (grid.rowHeight + POSTER_GAP_PX);
    return { x, y, width: grid.cardWidth, height: grid.cardHeight, captionY: y + grid.cardHeight + captionOffset };
  });
}

export function layoutPoster(count: number, options: PosterLayoutOptions): PosterLayout {
  if (!Number.isInteger(count) || count < 1) throw new RangeError(`a poster needs a whole number of cards from 1, got ${count}`);
  const cardCount = Math.min(count, POSTER_MAX_CARDS);
  const grid = bestGridOf(cardCount, options);
  return {
    width: grid.width,
    height: grid.height,
    headerHeight: grid.headerHeight,
    footerHeight: grid.footerHeight,
    columns: grid.columns,
    rows: grid.rows,
    cells: cellsOf(cardCount, grid, options),
  };
}
