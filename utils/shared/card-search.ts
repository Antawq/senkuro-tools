import { CARD_LINK, findShownName, slugFromHref } from './cards';
import type { Database } from './database';

export const normalizeText = (text: string): string => text.toLowerCase().replaceAll('ё', 'е');

export const searchWordsOf = (query: string): string[] => normalizeText(query).split(/\s+/).filter(Boolean);

export function rowSearchText(row: Element, database: Database): string {
  const link = row.querySelector<HTMLAnchorElement>(CARD_LINK);
  const slug = slugFromHref(link?.getAttribute('href'));
  const entry = slug ? database[slug] : undefined;
  const sources = [entry?.name, entry?.manga, link ? findShownName(link) : null, slug?.replaceAll('-', ' ')];
  return normalizeText(sources.filter(Boolean).join(' '));
}

export function isHiddenBySearch(words: readonly string[], row: Element, database: Database): boolean {
  if (words.length === 0) return false;
  const text = rowSearchText(row, database);
  return !words.every((word) => text.includes(word));
}
