import { defineContentScript } from '#imports';
import { SENKURO_MATCHES } from '@/utils/hosts';
import { installCapture } from '@/utils/trade-capture';

export default defineContentScript({
  matches: SENKURO_MATCHES,
  runAt: 'document_start',
  world: 'MAIN',
  main() {
    installCapture(window);
  },
});
