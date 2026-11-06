import type { SelectedCard } from './poster-cards';
import { CAPTION_HEIGHT_PX, POSTER_MARGIN_PX, POSTER_CARDS_PER_PAGE, layoutPoster, type PosterCell, type PosterLayout } from './poster-layout';

export interface PosterCardContent {
  selected: SelectedCard;
  image: CanvasImageSource | null;
  priceText: string | null;
}

export interface PosterContent {
  cards: readonly PosterCardContent[];
  heading: string;
  nickname: string | null;
  shouldShowQuantity: boolean;
}

export interface PosterTheme {
  background: string;
  surface: string;
  text: string;
  mutedText: string;
  shadow: string;
  fontFamily: string;
}

export interface RenderHost {
  createCanvas: (width: number, height: number) => HTMLCanvasElement;
}

const CARD_RADIUS_RATIO = 0.088;
const HEADING_FONT_PX = 64;
const CAPTION_FONT_PX = 28;
const FOOTER_FONT_PX = 32;
const PLACEHOLDER_FONT_RATIO = 0.3;
const HEADING_FONT_WEIGHT = 700;
const CAPTION_FONT_WEIGHT = 600;
const FOOTER_FONT_WEIGHT = 500;
const PLACEHOLDER_FONT_WEIGHT = 700;
const SHADOW_BLUR_PX = 24;
const SHADOW_OFFSET_Y_PX = 8;
const QUANTITY_SIGN = '×';
const CAPTION_SEPARATOR = ' · ';
const PLACEHOLDER_MARK = '?';
const PNG_TYPE = 'image/png';

const THEME_PROPERTIES = {
  background: '--senkutools-poster-background',
  surface: '--senkutools-poster-surface',
  text: '--senkutools-poster-text',
  mutedText: '--senkutools-poster-muted-text',
  shadow: '--senkutools-poster-shadow',
} as const;

function captionOf(card: PosterCardContent, shouldShowQuantity: boolean): string {
  const parts: string[] = [];
  if (shouldShowQuantity && card.selected.quantity > 1) parts.push(`${QUANTITY_SIGN}${card.selected.quantity}`);
  if (card.priceText) parts.push(card.priceText);
  return parts.join(CAPTION_SEPARATOR);
}

const fontOf = (weight: number, sizePx: number, theme: PosterTheme): string => `${weight} ${sizePx}px ${theme.fontFamily}`;

const radiusOf = (cell: PosterCell): number => Math.round(cell.width * CARD_RADIUS_RATIO);

function traceCard(drawing: CanvasRenderingContext2D, cell: PosterCell): void {
  drawing.beginPath();
  drawing.roundRect(cell.x, cell.y, cell.width, cell.height, radiusOf(cell));
}

function drawCardBase(drawing: CanvasRenderingContext2D, cell: PosterCell, theme: PosterTheme): void {
  drawing.save();
  drawing.shadowColor = theme.shadow;
  drawing.shadowBlur = SHADOW_BLUR_PX;
  drawing.shadowOffsetY = SHADOW_OFFSET_Y_PX;
  drawing.fillStyle = theme.surface;
  traceCard(drawing, cell);
  drawing.fill();
  drawing.restore();
}

function drawArt(drawing: CanvasRenderingContext2D, cell: PosterCell, image: CanvasImageSource): void {
  drawing.save();
  traceCard(drawing, cell);
  drawing.clip();
  drawing.imageSmoothingQuality = 'high';
  drawing.drawImage(image, cell.x, cell.y, cell.width, cell.height);
  drawing.restore();
}

function drawPlaceholderMark(drawing: CanvasRenderingContext2D, cell: PosterCell, theme: PosterTheme): void {
  drawing.font = fontOf(PLACEHOLDER_FONT_WEIGHT, Math.round(cell.width * PLACEHOLDER_FONT_RATIO), theme);
  drawing.fillStyle = theme.mutedText;
  drawing.fillText(PLACEHOLDER_MARK, cell.x + cell.width / 2, cell.y + cell.height / 2);
}

function drawCaption(drawing: CanvasRenderingContext2D, cell: PosterCell, caption: string, theme: PosterTheme): void {
  drawing.font = fontOf(CAPTION_FONT_WEIGHT, CAPTION_FONT_PX, theme);
  drawing.fillStyle = theme.text;
  drawing.fillText(caption, cell.x + cell.width / 2, cell.captionY + CAPTION_HEIGHT_PX / 2, cell.width);
}

function drawBandText(drawing: CanvasRenderingContext2D, layout: PosterLayout, text: string, centreY: number): void {
  drawing.fillText(text, layout.width / 2, centreY, layout.width - 2 * POSTER_MARGIN_PX);
}

function exportPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('the poster canvas produced no image'))), PNG_TYPE);
  });
}

export async function renderPoster(content: PosterContent, theme: PosterTheme, host: RenderHost): Promise<Blob> {
  const cards = content.cards.slice(0, POSTER_CARDS_PER_PAGE).map((card) => ({ ...card, caption: captionOf(card, content.shouldShowQuantity) }));
  const heading = content.heading.trim();
  const nickname = content.nickname?.trim();
  const hasCaptions = cards.some((card) => card.caption !== '');
  const layout = layoutPoster(cards.length, { hasHeading: heading !== '', hasFooter: Boolean(nickname), hasCaptions });
  const canvas = host.createCanvas(layout.width, layout.height);
  const drawing = canvas.getContext('2d');
  if (!drawing) throw new Error('the poster canvas has no 2D context');
  drawing.fillStyle = theme.background;
  drawing.fillRect(0, 0, layout.width, layout.height);
  drawing.textAlign = 'center';
  drawing.textBaseline = 'middle';
  if (heading !== '') {
    drawing.font = fontOf(HEADING_FONT_WEIGHT, HEADING_FONT_PX, theme);
    drawing.fillStyle = theme.text;
    drawBandText(drawing, layout, heading, POSTER_MARGIN_PX + layout.headerHeight / 2);
  }
  layout.cells.forEach((cell, index) => {
    const card = cards[index];
    if (!card) return;
    drawCardBase(drawing, cell, theme);
    if (card.image) drawArt(drawing, cell, card.image);
    else drawPlaceholderMark(drawing, cell, theme);
    if (card.caption !== '') drawCaption(drawing, cell, card.caption, theme);
  });
  if (nickname) {
    drawing.font = fontOf(FOOTER_FONT_WEIGHT, FOOTER_FONT_PX, theme);
    drawing.fillStyle = theme.mutedText;
    drawBandText(drawing, layout, nickname, layout.height - POSTER_MARGIN_PX - layout.footerHeight / 2);
  }
  return exportPng(canvas);
}

export function readPosterTheme(pageDocument: Document): PosterTheme {
  const rootStyle = getComputedStyle(pageDocument.documentElement);
  const colourOf = (property: string): string => rootStyle.getPropertyValue(property).trim();
  return {
    background: colourOf(THEME_PROPERTIES.background),
    surface: colourOf(THEME_PROPERTIES.surface),
    text: colourOf(THEME_PROPERTIES.text),
    mutedText: colourOf(THEME_PROPERTIES.mutedText),
    shadow: colourOf(THEME_PROPERTIES.shadow),
    fontFamily: getComputedStyle(pageDocument.body).fontFamily,
  };
}
