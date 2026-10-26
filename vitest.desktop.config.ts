import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  resolve: { alias: { '@thinkrail/contracts': resolve('vendor/thinkrail/packages/contracts/src/index.ts') } },
  esbuild: { jsx: 'automatic' },
  test: { include: ['tests/renderer/**/*.test.{ts,tsx}', 'tests/main/**/*.test.ts', 'tests/desktop/**/*.test.tsx'], environment: 'node', testTimeout: 15_000, fileParallelism: false },
});
