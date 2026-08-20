/**
 * Bundled OpenPets companion: the desktop product's pet surface when the
 * OpenPets app ships alongside the runtime. The native pet window remains the
 * development and fallback pet; OpenPets replaces it in packaged builds.
 * @module @deepseek-ai/dsh-desktop/openpets
 */

import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

/** The bundled OpenPets app directory relative to Electron's resources path. */
export const OPENPETS_RESOURCE_DIR = 'openpets'

/**
 * Resolve the bundled OpenPets executable, if the app is staged.
 * @param resourcesPath - Electron's `process.resourcesPath` (injectable for tests).
 * @returns the absolute executable path, or `undefined` when not bundled.
 */
export function openpetsExecutable(resourcesPath: string): string | undefined {
  const executable = join(resourcesPath, OPENPETS_RESOURCE_DIR, 'openpets.exe')
  return existsSync(executable) ? executable : undefined
}

/**
 * Launch the bundled OpenPets app detached from the desktop shell.
 * @param executable - the OpenPets executable from {@link openpetsExecutable}.
 * @returns the child process; the desktop shell does not supervise it.
 */
export function launchOpenpets(executable: string): ChildProcess {
  // Detached: OpenPets owns its window lifecycle, position, and quitting; the
  // desktop shell must not die with it (or vice versa). stdio is ignored so
  // the companion's own logs stay with the app, not the desktop shell.
  const child = spawn(executable, [], {
    detached: true,
    stdio: 'ignore',
    windowsHide: false,
  })
  child.unref()
  return child
}
