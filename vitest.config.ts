import { defineConfig } from 'vitest/config';
import path from 'path';
import fs from 'fs';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
  plugins: [
    {
      name: 'resolve-js-to-ts',
      resolveId(source, importer) {
        // Resolve .js imports to .ts source files (bundler-style)
        if (source.endsWith('.js') && importer && !source.includes('node_modules')) {
          const tsSource = source.replace(/\.js$/, '.ts');
          return this.resolve(tsSource, importer, { skipSelf: true });
        }
      },
    },
  ],
  test: {
    globals: true,
    environment: 'node',
    testTimeout: 15000,
    hookTimeout: 20000,
  },
});
