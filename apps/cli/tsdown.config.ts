import { defineConfig } from 'tsdown'

/**
 * The dsh application ships the CLI `bin` plus the standard-Node desktop Host
 * child entry. The root tsdown builds only `lib/types/index.js`, so this
 * override points at both application entries; their reachable modules bundle
 * with them.
 * Declarations come from `tsc -b` (dts: false), matching every package.
 */
export default defineConfig({
  entry: ['lib/types/bin.js', 'lib/types/desktop-host.js', 'lib/types/desktop-host-protocol.js'],
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  clean: false,
})
