import { execute, type Transport, type Variables } from '../shared/graphql';

export interface PosterArt {
  slug: string;
  rank: string;
  url: string;
  width: number;
  height: number;
  isExplicit: boolean;
}

export interface ArtHost {
  createImage: () => HTMLImageElement;
}

export const ART_BATCH_SIZE = 30;

const OPERATION_NAME = 'PosterArt';
const CARD_FIELDS = 'slug rank explicit image { original { url width height } }';
const SECURE_URL_PREFIX = 'https://';

interface ArtCard {
  rank?: unknown;
  explicit?: unknown;
  image?: { original?: { url?: unknown; width?: unknown; height?: unknown } | null } | null;
}

type ArtResponse = Record<string, ArtCard | null | undefined>;

const aliasOf = (index: number): string => `card${index}`;
const variableOf = (index: number): string => `slug${index}`;

function artDocument(slugCount: number): string {
  const indexes = Array.from({ length: slugCount }, (_, index) => index);
  const declarations = indexes.map((index) => `$${variableOf(index)}: String!`).join(', ');
  const selections = indexes.map((index) => `${aliasOf(index)}: card(slug: $${variableOf(index)}) { ${CARD_FIELDS} }`).join(' ');
  return `query ${OPERATION_NAME}(${declarations}) { ${selections} }`;
}

const variablesOf = (slugs: readonly string[]): Variables => Object.fromEntries(slugs.map((slug, index) => [variableOf(index), slug]));

const isSecureUrl = (url: unknown): url is string => typeof url === 'string' && url.startsWith(SECURE_URL_PREFIX);

const isDrawableSize = (size: unknown): size is number => typeof size === 'number' && Number.isFinite(size) && size > 0;

function toPosterArt(slug: string, card: ArtCard | null | undefined): PosterArt | null {
  const original = card?.image?.original;
  if (!card || !original) return null;
  const { url, width, height } = original;
  if (!isSecureUrl(url) || !isDrawableSize(width) || !isDrawableSize(height)) return null;
  return { slug, rank: typeof card.rank === 'string' ? card.rank : '', url, width, height, isExplicit: card.explicit === true };
}

export async function fetchPosterArt(slugs: readonly string[], transport?: Transport, signal?: AbortSignal): Promise<Map<string, PosterArt>> {
  const uniqueSlugs = [...new Set(slugs)];
  const arts = new Map<string, PosterArt>();
  for (let start = 0; start < uniqueSlugs.length; start += ART_BATCH_SIZE) {
    const batch = uniqueSlugs.slice(start, start + ART_BATCH_SIZE);
    const response = await execute<ArtResponse>(null, artDocument(batch.length), OPERATION_NAME, variablesOf(batch), transport, signal);
    batch.forEach((slug, index) => {
      const art = toPosterArt(slug, response[aliasOf(index)]);
      if (art) arts.set(slug, art);
    });
  }
  return arts;
}

export function loadArtImage(art: PosterArt, host: ArtHost): Promise<HTMLImageElement> {
  if (!isSecureUrl(art.url)) return Promise.reject(new Error(`poster art of ${art.slug} is not served over https`));
  return new Promise((resolve, reject) => {
    const image = host.createImage();
    image.crossOrigin = 'anonymous';
    image.addEventListener('load', () => resolve(image), { once: true });
    image.addEventListener('error', () => reject(new Error(`poster art of ${art.slug} failed to load`)), { once: true });
    image.src = art.url;
  });
}
