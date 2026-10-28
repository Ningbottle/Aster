import { defineConfig } from 'electron-vite';
import { resolve } from 'node:path';
import tailwindcss from 'tailwindcss';
import { readFileSync } from 'node:fs';

export default defineConfig({
  main: {
    resolve: { alias: { '@thinkrail/contracts': resolve('vendor/thinkrail/packages/contracts/src/index.ts') } },
    build: { outDir: 'out/desktop/main', rollupOptions: {
      input: resolve('src/main/index.ts'), output: { format: 'cjs', entryFileNames: 'index.cjs' },
    } },
  },
  preload: { build: { outDir: 'out/desktop/preload', rollupOptions: {
    input: resolve('src/preload/index.ts'), output: { format: 'cjs', entryFileNames: 'index.cjs' },
  } } },
  renderer: {
    root: '.', base: './', publicDir: false,
    resolve: { alias: { '@thinkrail/contracts': resolve('vendor/thinkrail/packages/contracts/src/index.ts') } },
    plugins: [{ name: 'aster-third-party-notices', generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'THIRD-PARTY-NOTICES.txt', source:
        'open-claude-ui components and theme:\n\n' + readFileSync('src/renderer/cds/LICENSE', 'utf8')
        + '\n\nPhosphor icons:\n\n' + readFileSync('node_modules/@phosphor-icons/react/LICENSE', 'utf8')
        + '\n\nreact-markdown:\n\n' + readFileSync('node_modules/react-markdown/license', 'utf8')
        + '\n\nremark-gfm:\n\n' + readFileSync('node_modules/remark-gfm/license', 'utf8')
        + '\n\npdfjs-dist:\n\n' + readFileSync('node_modules/pdfjs-dist/LICENSE', 'utf8')
        + '\n\nInter font (SIL OFL 1.1):\n\n' + readFileSync('src/renderer/assets/fonts/Inter-OFL.txt', 'utf8')
        + '\n\nCascadia Mono font (SIL OFL 1.1, Microsoft Corporation; files via @fontsource/cascadia-mono 5.3.0):\n\n' + readFileSync('src/renderer/assets/fonts/CascadiaMono-OFL.txt', 'utf8')
        + '\n\nPrismJS (MIT, 1.30.0):\n\n' + readFileSync('node_modules/prismjs/LICENSE', 'utf8')
        + '\n\nThinkRail — Copyright 2026 JetBrains s.r.o.:\n\n' + readFileSync('vendor/thinkrail/LICENSE', 'utf8') });
    } }],
    esbuild: { jsx: 'automatic' },
    css: { postcss: { plugins: [tailwindcss({
      content: ['src/renderer/**/*.{ts,tsx}'],
      darkMode: 'class',
      corePlugins: { preflight: false },
      theme: { extend: {
        colors: { clay: { DEFAULT: 'var(--cds-clay)', hover: 'var(--cds-clay-hover)' } },
        fontFamily: { sans: ['var(--ui-font)'] },
        transitionDuration: { fast: '120ms' },
        opacity: { 35: '.35' },
        spacing: { xs: 'var(--cds-gap-xs)', sm: 'var(--cds-gap-sm)', md: 'var(--cds-gap-md)' },
        boxShadow: { field: 'inset 0 0 0 1px var(--cds-alpha-1)', '2xs': '0 1px 2px rgb(0 0 0 / .04)' },
      } },
    })] } },
    server: { host: '127.0.0.1', watch: { ignored: ['**/out/**', '**/.tmp/**', '**/vendor/**'] } },
    build: { outDir: 'out/desktop/renderer', rollupOptions: { input: resolve('index.html') } },
  },
});
