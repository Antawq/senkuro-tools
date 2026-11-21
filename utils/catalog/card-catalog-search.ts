import { isAppMounted } from '../shared/app-mounted';
import { normalizeText, searchWordsOf } from '../shared/card-search';
import type { Database } from '../shared/database';
import { childWithClass, element } from '../shared/dom';
import { execute } from '../shared/graphql';
import { SEARCH_CLASS } from '../shared/modal-filter-nodes';
import { closeIcon, searchIcon } from '../shared/svg';
import { characterFilterSignal } from './character-filter';

export const CARD_SEARCH_CLASS = 'senkutools-card-search';
export const CARD_SEARCH_TEXT = {
  field: 'Имя персонажа',
  placeholder: 'Имя персонажа...',
  clear: 'Очистить',
  nothing: 'Персонаж не найден',
  failed: 'Не удалось найти персонажа',
} as const;

const CARDS_CATALOG_PATH = /^\/browse\/cards(\/|$)/;
const CATALOG = '.catalog-cnt';
const CATALOG_NAV_CLASS = 'catalog-cnt__nav';
const LIST_CLASS = `${CARD_SEARCH_CLASS}__list`;
const OPTION_CLASS = `${CARD_SEARCH_CLASS}__option`;
const OPTION_TITLE_CLASS = `${CARD_SEARCH_CLASS}__title`;
const NOTE_CLASS = `${CARD_SEARCH_CLASS}__note`;
const SUGGESTION_LIMIT = 8;
const ICON_SIZE_PX = 16;
const CARD_CHARACTER = 'query CardCharacter($slug: String!) { card(slug: $slug) { character { id } } }';

export interface CharacterSuggestion {
  slug: string;
  name: string;
  title: string;
}

interface IndexedCard extends CharacterSuggestion {
  text: string;
}

interface CardCharacterData {
  card?: { character?: { id?: unknown } | null } | null;
}

export interface CardSearchHost {
  findCharacterId: (slug: string) => Promise<string | null>;
  applyCharacter: (characterId: string) => void;
}

const indexes = new WeakMap<Database, IndexedCard[]>();

function indexOf(database: Database): IndexedCard[] {
  let index = indexes.get(database);
  if (!index) {
    const seen = new Set<string>();
    index = [];
    for (const [slug, entry] of Object.entries(database)) {
      const name = entry?.name?.trim();
      if (!entry || !name) continue;
      const title = entry.manga?.trim() ?? '';
      const key = `${name}\n${title}`;
      if (seen.has(key)) continue;
      seen.add(key);
      index.push({ slug, name, title, text: normalizeText(`${name} ${title} ${slug.replaceAll('-', ' ')}`) });
    }
    indexes.set(database, index);
  }
  return index;
}

export function suggestCharacters(database: Database, query: string): CharacterSuggestion[] {
  const words = searchWordsOf(query);
  if (words.length === 0) return [];
  const suggestions: CharacterSuggestion[] = [];
  for (const card of indexOf(database)) {
    if (!words.every((word) => card.text.includes(word))) continue;
    suggestions.push({ slug: card.slug, name: card.name, title: card.title });
    if (suggestions.length === SUGGESTION_LIMIT) break;
  }
  return suggestions;
}

export async function fetchCharacterId(slug: string): Promise<string | null> {
  const data = await execute<CardCharacterData>(null, CARD_CHARACTER, 'CardCharacter', { slug });
  const id = data.card?.character?.id;
  return typeof id === 'string' && id !== '' ? id : null;
}

export const createCardSearchHost = (pageDocument: Document): CardSearchHost => ({
  findCharacterId: fetchCharacterId,
  applyCharacter: (characterId) =>
    void pageDocument.dispatchEvent(new CustomEvent(characterFilterSignal.name, { detail: characterFilterSignal.encode({ characterId }) })),
});

function createOption(suggestion: CharacterSuggestion, pick: (suggestion: CharacterSuggestion) => void): HTMLButtonElement {
  const option = element('button', OPTION_CLASS, suggestion.name);
  option.type = 'button';
  option.setAttribute('role', 'option');
  if (suggestion.title) option.append(element('span', OPTION_TITLE_CLASS, suggestion.title));
  option.addEventListener('pointerdown', (event) => event.preventDefault());
  option.addEventListener('click', () => pick(suggestion));
  return option;
}

function createSearch(readDatabase: () => Database, host: CardSearchHost): HTMLElement {
  const root = element('div', `${SEARCH_CLASS} ${SEARCH_CLASS}--open ${CARD_SEARCH_CLASS}`);
  const box = element('div', `${SEARCH_CLASS}__box`);
  const icon = element('span', `${SEARCH_CLASS}__close`);
  icon.setAttribute('aria-hidden', 'true');
  icon.append(searchIcon(ICON_SIZE_PX));
  const input = element('input', `${SEARCH_CLASS}__input`);
  input.type = 'text';
  input.placeholder = CARD_SEARCH_TEXT.placeholder;
  input.autocomplete = 'off';
  input.spellcheck = false;
  input.setAttribute('aria-label', CARD_SEARCH_TEXT.field);
  const clear = element('button', `${SEARCH_CLASS}__clear`);
  clear.type = 'button';
  clear.title = CARD_SEARCH_TEXT.clear;
  clear.setAttribute('aria-label', CARD_SEARCH_TEXT.clear);
  clear.hidden = true;
  clear.append(closeIcon(ICON_SIZE_PX));
  const list = element('div', LIST_CLASS);
  list.setAttribute('role', 'listbox');
  list.hidden = true;
  let suggestions: CharacterSuggestion[] = [];

  const showNote = (text: string): void => {
    list.replaceChildren(element('p', NOTE_CLASS, text));
    list.hidden = false;
  };
  const pick = (suggestion: CharacterSuggestion): void => {
    input.value = suggestion.name;
    list.hidden = true;
    host.findCharacterId(suggestion.slug).then(
      (characterId) => (characterId ? host.applyCharacter(characterId) : showNote(CARD_SEARCH_TEXT.failed)),
      () => showNote(CARD_SEARCH_TEXT.failed)
    );
  };
  const refresh = (): void => {
    clear.hidden = input.value === '';
    suggestions = suggestCharacters(readDatabase(), input.value);
    if (input.value.trim() === '') {
      list.hidden = true;
      return;
    }
    if (suggestions.length === 0) return showNote(CARD_SEARCH_TEXT.nothing);
    list.replaceChildren(...suggestions.map((suggestion) => createOption(suggestion, pick)));
    list.hidden = false;
  };
  const reset = (): void => {
    input.value = '';
    refresh();
    input.focus();
  };

  input.addEventListener('input', refresh);
  input.addEventListener('focus', refresh);
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && suggestions[0]) {
      event.preventDefault();
      pick(suggestions[0]);
    }
  });
  clear.addEventListener('click', reset);
  root.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || input.value === '') return;
    event.preventDefault();
    event.stopPropagation();
    reset();
  });
  root.addEventListener('focusout', (event) => {
    if (!(event.relatedTarget instanceof Node && root.contains(event.relatedTarget))) list.hidden = true;
  });
  box.append(icon, input, clear);
  root.append(box, list);
  return root;
}

let currentDatabase: Database = {};

export function syncCardCatalogSearch(pageDocument: Document, database: Database, host: CardSearchHost): void {
  currentDatabase = database;
  const catalog = pageDocument.querySelector(CATALOG);
  const isCardsCatalog = CARDS_CATALOG_PATH.test(pageDocument.defaultView?.location.pathname ?? '');
  const placed = pageDocument.querySelector(`.${CARD_SEARCH_CLASS}`);
  if (!catalog || !isCardsCatalog || !isAppMounted(pageDocument)) return placed?.remove();
  if (placed?.parentElement === catalog) return;
  placed?.remove();
  const search = createSearch(() => currentDatabase, host);
  const nav = childWithClass(catalog, CATALOG_NAV_CLASS);
  if (nav) nav.after(search);
  else catalog.prepend(search);
}

export const isCardCatalogSearchMissing = (pageDocument: Document): boolean =>
  isAppMounted(pageDocument) &&
  CARDS_CATALOG_PATH.test(pageDocument.defaultView?.location.pathname ?? '') &&
  pageDocument.querySelector(CATALOG) !== null &&
  pageDocument.querySelector(`${CATALOG} > .${CARD_SEARCH_CLASS}`) === null;
