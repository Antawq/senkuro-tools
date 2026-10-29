import { defineContentScript } from '#imports';
import { catalogFallbackExchange } from '@/utils/catalog/catalog-fallback';
import { installCatalogRouting } from '@/utils/catalog/catalog-search';
import { createSearchPublisher, searchExchange } from '@/utils/search/search-exchange';
import { installClientSwap } from '@/utils/shared/client-swap';
import { SENKURO_MATCHES } from '@/utils/shared/hosts';

export default defineContentScript({
  matches: SENKURO_MATCHES,
  runAt: 'document_start',
  world: 'MAIN',
  main() {
    installClientSwap(window, {
      exchangesFor: () => [searchExchange(createSearchPublisher(window)), catalogFallbackExchange(installCatalogRouting(document))],
    });
  },
});
