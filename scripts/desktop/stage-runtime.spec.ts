import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  DESKTOP_NODE_VERSION,
  expectedChecksum,
  installedPackageInventory,
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
})
