import { defineContentScript } from '#imports';
import { SENKURO_MATCHES } from '@/utils/shared/hosts';
import { installSearchSize } from '@/utils/search/search-size';

export default defineContentScript({
  matches: SENKURO_MATCHES,
  runAt: 'document_start',
  world: 'MAIN',
  main() {
    installSearchSize(window);
  },
});
