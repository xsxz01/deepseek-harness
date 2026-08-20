import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  addBuiltinDependencies,
  BUILTIN_PLUGINS,
  BUILTIN_REACT_OVERRIDES,
  builtinDependencySpec,
  DESKTOP_NODE_VERSION,
  expectedChecksum,
  installedPackageInventory,
  runtimeDependencies,
  stageOpenpets,
} from './stage-runtime.ts'

const temporaryDirectories: string[] = []

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'dsh-desktop-stage-'))
  temporaryDirectories.push(directory)
  return directory
}

function writePackage(directory: string, manifest: object): void {
  mkdirSync(directory, { recursive: true })
  writeFileSync(join(directory, 'package.json'), JSON.stringify(manifest))
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('desktop runtime staging', () => {
  it('pins a Node 24 release supported by the product engines', () => {
    expect(DESKTOP_NODE_VERSION).toMatch(/^24\.\d+\.\d+$/u)
  })

  it('selects the exact archive checksum from the Node release listing', () => {
    const checksum = 'a'.repeat(64)
    expect(expectedChecksum(checksum + '  node-v24.19.0-win-x64.zip\n', 'node-v24.19.0-win-x64.zip'))
      .toBe(checksum)
  })

  it('rejects a missing or malformed checksum record', () => {
    expect(() => expectedChecksum('short  node-v24.19.0-win-x64.zip\n', 'node-v24.19.0-win-x64.zip'))
      .toThrow('has no entry')
    expect(() => expectedChecksum('', 'node-v24.19.0-win-x64.zip')).toThrow('has no entry')
  })

  it('inventories scoped and nested production dependencies', () => {
    const root = temporaryDirectory()
    writePackage(join(root, 'node_modules', 'alpha'), { name: 'alpha', version: '1.0.0', license: 'MIT' })
    writePackage(join(root, 'node_modules', '@scope', 'beta'), {
      name: '@scope/beta',
      version: '2.0.0',
      license: { type: 'Apache-2.0' },
    })
    writePackage(join(root, 'node_modules', 'alpha', 'node_modules', 'gamma'), {
      name: 'gamma',
      version: '3.0.0',
    })

    expect(installedPackageInventory(root)).toEqual([
      { name: '@scope/beta', version: '2.0.0', license: 'Apache-2.0' },
      { name: 'alpha', version: '1.0.0', license: 'MIT' },
      { name: 'gamma', version: '3.0.0', license: 'UNKNOWN' },
    ])
  })

  it('ships the builtin plugin set with exact registry versions', () => {
    expect(BUILTIN_PLUGINS).toEqual([
      { name: '@deepseek-harness-tui/dsh-tui', version: '0.8.6' },
      { name: '@linxin666/dsh-web-ui-all', version: '0.2.5' },
      { name: '@nanmicoder/dsh-agent-teams', version: '0.1.8' },
      { name: 'dsh-at-file', version: '0.6.3' },
    ])
    const names = new Set(BUILTIN_PLUGINS.map(plugin => plugin.name))
    expect(names.size).toBe(BUILTIN_PLUGINS.length)
    for (const plugin of BUILTIN_PLUGINS) {
      expect(plugin.name.length).toBeGreaterThan(0)
      expect(plugin.version).toMatch(/^\d+\.\d+\.\d+(?:-\S+)?$/u)
      expect(builtinDependencySpec(plugin)).toBe(plugin.version)
    }
  })

  it('pins the staged React tree to one react instance for dsh-tui', () => {
    expect(BUILTIN_REACT_OVERRIDES).toEqual({ react: '19.2.0', 'react-dom': '19.2.0' })
    for (const [name, spec] of Object.entries(BUILTIN_REACT_OVERRIDES)) {
      expect(spec).toMatch(/^\d+\.\d+\.\d+$/u)
      expect(name.length).toBeGreaterThan(0)
    }
  })

  it('merges the runtime dependencies from packed tarballs and builtin registry specs', () => {
    const packed = new Map([
      ['@deepseek-ai/dsh', { url: 'file:///packed/dsh.tgz', version: '0.1.0-rc.8' }],
      ['dsh-at-file', { url: 'file:///packed/at-file.tgz', version: '0.0.0-workspace' }],
    ])
    const dependencies = runtimeDependencies(packed)
    expect(dependencies['@deepseek-ai/dsh']).toBe('file:///packed/dsh.tgz')
    // A workspace package with the same name shadows the builtin spec.
    expect(dependencies['dsh-at-file']).toBe('file:///packed/at-file.tgz')
    expect(dependencies['@deepseek-harness-tui/dsh-tui']).toBe('0.8.6')
    expect(dependencies['@linxin666/dsh-web-ui-all']).toBe('0.2.5')
    expect(dependencies['@nanmicoder/dsh-agent-teams']).toBe('0.1.8')
  })

  it('records the builtin plugins in the CLI manifest for the profile heal closure', () => {
    const manifest = addBuiltinDependencies({
      name: '@deepseek-ai/dsh',
      version: '0.1.0-rc.8',
      dependencies: { '@deepseek-ai/dsh-agent': '0.1.0-rc.8' },
    })
    expect(manifest.dependencies['@deepseek-ai/dsh-agent']).toBe('0.1.0-rc.8')
    for (const plugin of BUILTIN_PLUGINS) {
      expect(manifest.dependencies[plugin.name]).toBe(plugin.version)
    }
    // The merge never drops an existing dependency entry.
    expect(manifest.dependencies).toHaveProperty('@deepseek-ai/dsh-agent')
  })

  it('stages the OpenPets companion from a built unpacked output', () => {
    const root = temporaryDirectory()
    const source = join(root, 'openpets-source')
    const unpacked = join(source, 'apps', 'desktop', 'dist-electron', 'win-unpacked')
    mkdirSync(unpacked, { recursive: true })
    writeFileSync(join(unpacked, 'openpets.exe'), '')
    writeFileSync(join(source, 'package.json'), JSON.stringify({ name: 'openpets-v2-workspace' }))

    const outputRoot = join(root, 'output')
    mkdirSync(outputRoot, { recursive: true })
    stageOpenpets(outputRoot, source)
    expect(existsSync(join(outputRoot, 'openpets', 'openpets.exe'))).toBe(true)
  })

  it('keeps the native pet with an honest note when OpenPets has no source', () => {
    const outputRoot = join(temporaryDirectory(), 'output')
    mkdirSync(outputRoot, { recursive: true })
    stageOpenpets(outputRoot, undefined)
    const note = readFileSync(join(outputRoot, 'openpets', 'README.txt'), 'utf8')
    expect(note).toContain('native pet window')
  })
})
