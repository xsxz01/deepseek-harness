import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  DEFAULT_DESKTOP_PREFERENCES,
  loadDesktopPreferences,
  parseDesktopPreferences,
  saveDesktopPreferences,
} from '../src/preferences.ts'

const temporaryDirectories: string[] = []

function createTemporaryDirectory(prefix: string): string {
  const directory = mkdtempSync(join(tmpdir(), prefix))
  temporaryDirectories.push(directory)
  return directory
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('desktop preferences', () => {
  it('validates only companion state', () => {
    expect(parseDesktopPreferences({ pet: { enabled: true, position: { x: 20, y: 40 } } })).toEqual({
      pet: { enabled: true, position: { x: 20, y: 40 } },
    })
    expect(parseDesktopPreferences({ pet: { enabled: false }, extra: true })).toBeUndefined()
    expect(parseDesktopPreferences({ skin: 'graphite', pet: { enabled: false } })).toBeUndefined()
    expect(parseDesktopPreferences({ pet: { enabled: true, position: { x: 1.5, y: 2 } } })).toBeUndefined()
  })

  it('uses defaults for absent or malformed state', () => {
    const directory = createTemporaryDirectory('desktop-preferences-')
    const path = join(directory, 'preferences.json')
    expect(loadDesktopPreferences(path)).toEqual(DEFAULT_DESKTOP_PREFERENCES)
    writeFileSync(path, '{bad json', 'utf8')
    expect(loadDesktopPreferences(path)).toEqual(DEFAULT_DESKTOP_PREFERENCES)
  })

  it('atomically saves preferences', () => {
    const directory = createTemporaryDirectory('desktop-preferences-save-')
    const path = join(directory, 'preferences.json')
    saveDesktopPreferences(path, { pet: { enabled: true, position: { x: 8, y: 9 } } })
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({
      pet: { enabled: true, position: { x: 8, y: 9 } },
    })
  })
})
