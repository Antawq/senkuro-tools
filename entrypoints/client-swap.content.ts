import { defineContentScript } from '#imports';
import { catalogFallbackExchange } from '@/utils/catalog/catalog-fallback';
import { installCatalogRouting } from '@/utils/catalog/catalog-search';
import { installInventoryGuard } from '@/utils/inventory/inventory-guard';
import { createCursorLedger, cursorExchange } from '@/utils/inventory/list-cursors';
import { familyIdOf } from '@/utils/inventory/list-families';
import { createSearchPublisher, searchExchange } from '@/utils/search/search-exchange';
import { installClientSwap } from '@/utils/shared/client-swap';
import { debugLogger } from '@/utils/shared/debug';
import { SENKURO_MATCHES } from '@/utils/shared/hosts';

export default defineContentScript({
  matches: SENKURO_MATCHES,
  runAt: 'document_start',
  world: 'MAIN',
  main() {
    installClientSwap(window, () => {
      const debug = debugLogger(window);
      const inventory = installInventoryGuard(window);
      return {
        exchangesFor: () => [
          searchExchange(createSearchPublisher(window)),
          catalogFallbackExchange(installCatalogRouting(document)),
          cursorExchange(createCursorLedger(), (variables) => debug('stale cursor dropped', { list: familyIdOf(variables), after: variables.after })),
          ...inventory.exchanges,
        ],
        onSwapped: inventory.attach,
      };
    });
  },
});
