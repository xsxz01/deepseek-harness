import { describe, expect, it } from 'vitest'
import { resolveDesktopHostRuntime } from '../src/paths.ts'

describe('desktop Host runtime paths', () => {
  it('uses explicit development runtime overrides', () => {
    expect(resolveDesktopHostRuntime(false, 'unused', {
      DSH_DESKTOP_NODE: 'C:\\runtime\\node.exe',
      DSH_DESKTOP_HOST_MODULE: 'C:\\fixture\\desktop-host.mjs',
      npm_node_execpath: 'C:\\ignored\\node.exe',
    })).toEqual({
      execPath: 'C:\\runtime\\node.exe',
      modulePath: 'C:\\fixture\\desktop-host.mjs',
    })
  })

  it('prefers the package-manager Node when no explicit runtime is configured', () => {
    const runtime = resolveDesktopHostRuntime(false, 'unused', {
      DSH_DESKTOP_HOST_MODULE: 'C:\\fixture\\desktop-host.mjs',
      npm_node_execpath: 'C:\\pnpm\\node.exe',
    })
    expect(runtime.execPath).toBe('C:\\pnpm\\node.exe')
  })
})
