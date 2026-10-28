import { defineContentScript } from '#imports';
import { installClientSwap } from '@/utils/shared/client-swap';
import { SENKURO_MATCHES } from '@/utils/shared/hosts';

export default defineContentScript({
  matches: SENKURO_MATCHES,
  runAt: 'document_start',
  world: 'MAIN',
  main() {
    installClientSwap(window, { exchangesFor: () => [] });
  },
});
