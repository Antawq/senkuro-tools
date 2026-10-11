import { defineContentScript } from '#imports';
import { installCapture } from '@/utils/trade-capture';

export default defineContentScript({
  matches: ['*://*.senkuro.com/*', '*://*.senkuro.me/*', '*://*.shiruho.com/*', '*://*.shiruho.me/*', '*://*.senkognito.com/*', '*://*.senkognito.me/*'],
  runAt: 'document_start',
  world: 'MAIN',
  main() {
    installCapture(window);
  },
});
