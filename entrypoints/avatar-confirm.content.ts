import { defineContentScript } from '#imports';
import { SENKURO_MATCHES } from '@/utils/shared/hosts';
import { createSiteAssets, findModals, installAvatarConfirm } from '@/utils/avatar/avatar-confirm';

export default defineContentScript({
  matches: SENKURO_MATCHES,
  runAt: 'document_start',
  world: 'MAIN',
  main() {
    installAvatarConfirm({ doc: document, modals: () => findModals(document), assets: createSiteAssets(window) });
  },
});
