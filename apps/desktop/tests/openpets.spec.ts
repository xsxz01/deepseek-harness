import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { openpetsExecutable, OPENPETS_RESOURCE_DIR } from '../src/openpets.ts'

const temporaryDirectories: string[] = []

function temporaryResources(): string {
  const directory = mkdtempSync(join(tmpdir(), 'dsh-openpets-'))
  temporaryDirectories.push(directory)
  return directory
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('bundled OpenPets companion', () => {
  it('resolves the executable when the companion app is staged', () => {
    const resources = temporaryResources()
    expect(openpetsExecutable(resources)).toBeUndefined()
    const appDir = join(resources, OPENPETS_RESOURCE_DIR)
    mkdirSync(appDir, { recursive: true })
    writeFileSync(join(appDir, 'openpets.exe'), '')
    expect(openpetsExecutable(resources)).toBe(join(appDir, 'openpets.exe'))
  })

  it('stays absent when only part of the companion is staged', () => {
    const resources = temporaryResources()
    mkdirSync(join(resources, OPENPETS_RESOURCE_DIR), { recursive: true })
    writeFileSync(join(resources, OPENPETS_RESOURCE_DIR, 'README.txt'), 'not bundled')
    expect(openpetsExecutable(resources)).toBeUndefined()
  })
})
