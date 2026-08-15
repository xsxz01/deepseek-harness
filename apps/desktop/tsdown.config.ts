import { defineConfig } from 'tsdown'

/** Bundle the Electron main process; TypeScript declarations come from tsc. */
export default defineConfig({
  entry: ['lib/types/main.js'],
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  deps: { neverBundle: ['electron'] },
  fixedExtension: false,
  dts: false,
  clean: false,
})
