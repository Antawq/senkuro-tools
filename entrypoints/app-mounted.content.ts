import { defineContentScript } from '#imports';
import { announceMounted } from '@/utils/shared/app-mounted';
import { SENKURO_MATCHES } from '@/utils/shared/hosts';

export default defineContentScript({
  matches: SENKURO_MATCHES,
  runAt: 'document_start',
  world: 'MAIN',
  main() {
    announceMounted(window);
  },
});
