import { copyFile, readFile } from 'node:fs/promises';

import { defineConfig } from 'wxt';

import { SENKURO_MATCHES } from './utils/hosts';

const DATABASE = 'database.json';

export default defineConfig({
  imports: false,
  manifestVersion: 3,
  zip: { excludeSources: ['**/*.local.*'] },
  hooks: {
    'build:publicAssets': async (_wxt, files) => {
      const index = files.findIndex((file) => file.relativeDest === DATABASE);
      const file = files[index];
      if (!file || !('absoluteSrc' in file)) return;
      files[index] = { relativeDest: DATABASE, contents: JSON.stringify(JSON.parse(await readFile(file.absoluteSrc, 'utf8'))) };
    },
    'zip:extension:done': async (wxt, zipPath) => {
      if (wxt.config.browser === 'firefox') await copyFile(zipPath, zipPath.replace(/-firefox\.zip$/, '.xpi'));
    },
  },
  manifest: ({ browser }) => ({
    name: 'SenkuTools',
    permissions: ['storage', 'clipboardWrite', 'cookies'],
    host_permissions: SENKURO_MATCHES,
    web_accessible_resources: [{ resources: [DATABASE], matches: SENKURO_MATCHES }],
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
