import { defineContentScript } from '#imports';
import { SENKURO_MATCHES } from '@/utils/shared/hosts';
import { installCapture } from '@/utils/trades/trade-capture';

export default defineContentScript({
  matches: SENKURO_MATCHES,
  runAt: 'document_start',
  world: 'MAIN',
  main() {
    installCapture(window);
  },
});
