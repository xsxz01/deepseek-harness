/** Durable desktop companion preferences. */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { Point } from 'electron'

/** Persisted desktop companion preferences. */
interface DesktopPetPreferences {
  enabled: boolean
  position?: Point
}

/** Desktop-only preferences independent of the hosted Web profile. */
export interface DesktopPreferences {
  pet: DesktopPetPreferences
}

/** Default desktop product settings. */
export const DEFAULT_DESKTOP_PREFERENCES: DesktopPreferences = {
  pet: { enabled: false },
}

/** Return whether a value is a finite integer. */
function isInteger(value: unknown): value is number {
  return Number.isSafeInteger(value)
}

/** Validate desktop preferences from the user-data directory. */
export function parseDesktopPreferences(value: unknown): DesktopPreferences | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  if (Object.keys(record).length !== 1 || typeof record.pet !== 'object' || record.pet === null || Array.isArray(record.pet)) return undefined
  const pet = record.pet as Record<string, unknown>
  if (typeof pet.enabled !== 'boolean') return undefined
  if (pet.position === undefined) {
    if (Object.keys(pet).length !== 1) return undefined
    return { pet: { enabled: pet.enabled } }
  }
  if (Object.keys(pet).length !== 2
    || typeof pet.position !== 'object'
    || pet.position === null
    || Array.isArray(pet.position)) return undefined
  const position = pet.position as Record<string, unknown>
  if (Object.keys(position).length !== 2 || !isInteger(position.x) || !isInteger(position.y)) return undefined
  return { pet: { enabled: pet.enabled, position: { x: position.x, y: position.y } } }
}

/**
 * Read desktop preferences, returning product defaults for absence or invalid JSON.
 * @param path - preferences file under Electron's user-data directory.
 * @returns validated preferences or fresh defaults.
 */
export function loadDesktopPreferences(path: string): DesktopPreferences {
  let source: string
  try {
    source = readFileSync(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return structuredClone(DEFAULT_DESKTOP_PREFERENCES)
    throw error
  }
  try {
    return parseDesktopPreferences(JSON.parse(source)) ?? structuredClone(DEFAULT_DESKTOP_PREFERENCES)
  } catch (error) {
    if (error instanceof SyntaxError) return structuredClone(DEFAULT_DESKTOP_PREFERENCES)
    throw error
  }
}

/**
 * Atomically persist desktop-only preferences.
 * @param path - preferences file under Electron's user-data directory.
 * @param preferences - complete current desktop preferences.
 */
export function saveDesktopPreferences(path: string, preferences: DesktopPreferences): void {
  mkdirSync(dirname(path), { recursive: true })
  const temporary = path + '.tmp'
  writeFileSync(temporary, JSON.stringify(preferences) + '\n', 'utf8')
  renameSync(temporary, path)
}
