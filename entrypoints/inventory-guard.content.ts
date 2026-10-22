import { defineContentScript } from '#imports';
import { SENKURO_MATCHES } from '@/utils/shared/hosts';
import { installInventoryGuard } from '@/utils/inventory/inventory-guard';

export default defineContentScript({
  matches: SENKURO_MATCHES,
  runAt: 'document_start',
  world: 'MAIN',
  main() {
    installInventoryGuard(window);
  },
});
