import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const requireFromWeb = createRequire(new URL('../apps/web/package.json', import.meta.url));

export const webViteBin = join(
  dirname(requireFromWeb.resolve('vite/package.json')),
  'bin',
  'vite.js',
);
