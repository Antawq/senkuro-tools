import { defineContentScript } from '#imports';
import { SENKURO_MATCHES } from '@/utils/shared/hosts';
import { createSiteAssets, findSiteModals, installAvatarConfirm } from '@/utils/avatar/avatar-confirm';

export default defineContentScript({
  matches: SENKURO_MATCHES,
  runAt: 'document_start',
  world: 'MAIN',
  main() {
    installAvatarConfirm({ pageDocument: document, findSiteModals: () => findSiteModals(document), assets: createSiteAssets(window) });
  },
});
