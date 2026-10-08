import { copyFile } from 'node:fs/promises';

import { defineConfig } from 'wxt';

const SENKURO_HOSTS = ['*://*.senkuro.com/*', '*://*.senkuro.me/*'];

export default defineConfig({
  imports: false,
  manifestVersion: 3,
  zip: { excludeSources: ['**/*.local.*'] },
  hooks: {
    'zip:extension:done': async (wxt, zipPath) => {
      if (wxt.config.browser === 'firefox') await copyFile(zipPath, zipPath.replace(/-firefox\.zip$/, '.xpi'));
    },
  },
  manifest: ({ browser }) => ({
    name: 'SenkuTools',
    permissions: ['storage', 'clipboardWrite', 'cookies'],
    host_permissions: SENKURO_HOSTS,
    web_accessible_resources: [{ resources: ['database.json'], matches: SENKURO_HOSTS }],
    ...(browser === 'firefox' && {
      browser_specific_settings: {
        gecko: {
          id: 'senkuro_price@example.com',
          strict_min_version: '142.0',
          data_collection_permissions: { required: ['none'] },
        },
      },
    }),
  }),
});
