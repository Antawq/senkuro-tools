import { defineSignal } from '../shared/signal';
import { findVueApp } from '../shared/vue-app';
import { ROUTER_PROPERTY, fieldsOf, type CatalogLocation } from './catalog-search';

export interface CharacterFilter {
  characterId: string;
}

interface CardsTarget {
  name: string;
  params: Record<string, unknown>;
  query: Record<string, unknown>;
}

interface CardsRouter {
  push: (target: CardsTarget) => Promise<unknown>;
  currentRoute: { value: CatalogLocation };
}

export const CARDS_ROUTE_NAME = 'browse-cards';
export const CHARACTERS_FIELD = 'characters';

export const characterFilterSignal = defineSignal<CharacterFilter>('senkutools:catalog-character', ({ characterId }) =>
  typeof characterId === 'string' && characterId !== '' ? { characterId } : null
);

export function withCharacter(fields: readonly unknown[], characterId: string): string[] {
  const kept: string[] = [];
  for (let index = 0; index + 1 < fields.length; index += 2) {
    const key = String(fields[index]);
    if (key !== CHARACTERS_FIELD) kept.push(key, String(fields[index + 1]));
  }
  return [...kept, CHARACTERS_FIELD, characterId];
}

function findCardsRouter(pageDocument: Document): CardsRouter | null {
  const router = findVueApp(pageDocument)?.config?.globalProperties?.[ROUTER_PROPERTY] as Partial<CardsRouter> | null | undefined;
  return typeof router?.push === 'function' && router.currentRoute ? (router as CardsRouter) : null;
}

export function installCharacterFilter(pageDocument: Document): void {
  pageDocument.addEventListener(characterFilterSignal.name, (event) => {
    const filter = characterFilterSignal.read(event);
    const router = findCardsRouter(pageDocument);
    const route = router?.currentRoute.value;
    if (!filter || !router || route?.name !== CARDS_ROUTE_NAME) return;
    router
      .push({ name: CARDS_ROUTE_NAME, params: { ...route.params, fields: withCharacter(fieldsOf(route), filter.characterId) }, query: route.query })
      .catch((error: unknown) => console.error('SenkuTools: character filter failed', error));
  });
}
