/** Durable placement for the Electron desktop window. */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { Rectangle } from 'electron'

/** Minimum desktop window dimensions. */
export const DESKTOP_WINDOW_MINIMUM = { width: 900, height: 640 } as const

/** Persisted placement independent of Electron's display identifiers. */
export interface DesktopWindowState {
  bounds: Rectangle
  maximized: boolean
}

/** Return whether a value is a finite integer. */
function isInteger(value: unknown): value is number {
  return Number.isSafeInteger(value)
}

/** Validate a window state read from the durable user-data directory. */
function parseWindowState(value: unknown): DesktopWindowState | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  if (Object.keys(record).length !== 2 || typeof record.maximized !== 'boolean') return undefined
  const bounds = record.bounds
  if (typeof bounds !== 'object' || bounds === null || Array.isArray(bounds)) return undefined
  const rectangle = bounds as Record<string, unknown>
  if (Object.keys(rectangle).length !== 4
    || !isInteger(rectangle.x)
    || !isInteger(rectangle.y)
    || !isInteger(rectangle.width)
    || !isInteger(rectangle.height)
    || rectangle.width < DESKTOP_WINDOW_MINIMUM.width
    || rectangle.height < DESKTOP_WINDOW_MINIMUM.height) return undefined
  return {
    bounds: {
      x: rectangle.x,
      y: rectangle.y,
      width: rectangle.width,
      height: rectangle.height,
    },
    maximized: record.maximized,
  }
}

/**
 * Read a persisted window state, treating absence or invalid JSON as no state.
 * @param path - state file under Electron's user-data directory.
 * @returns the validated state, or undefined when no usable state exists.
 */
export function loadDesktopWindowState(path: string): DesktopWindowState | undefined {
  let source: string
  try {
    source = readFileSync(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
  try {
    return parseWindowState(JSON.parse(source))
  } catch (error) {
    if (error instanceof SyntaxError) return undefined
    throw error
  }
}

/** Return the positive intersection area between two rectangles. */
function intersectionArea(left: Rectangle, right: Rectangle): number {
  const width = Math.max(0, Math.min(left.x + left.width, right.x + right.width) - Math.max(left.x, right.x))
  const height = Math.max(0, Math.min(left.y + left.height, right.y + right.height) - Math.max(left.y, right.y))
  return width * height
}

/**
 * Keep a restored window visible after monitor topology or work-area changes.
 * @param state - validated persisted placement.
 * @param workAreas - current display work areas, with the primary display first.
 * @returns placement clamped to the best current display, or undefined without state or displays.
 */
export function restoreDesktopWindowState(
  state: DesktopWindowState | undefined,
  workAreas: readonly Rectangle[],
): DesktopWindowState | undefined {
  if (state === undefined || workAreas.length === 0) return undefined
  const target = workAreas.reduce((best, area) => (
    intersectionArea(state.bounds, area) > intersectionArea(state.bounds, best) ? area : best
  ))
  const width = Math.min(state.bounds.width, target.width)
  const height = Math.min(state.bounds.height, target.height)
  const x = Math.min(Math.max(state.bounds.x, target.x), target.x + target.width - width)
  const y = Math.min(Math.max(state.bounds.y, target.y), target.y + target.height - height)
  return { bounds: { x, y, width, height }, maximized: state.maximized }
}

/**
 * Atomically persist the normal placement and maximized state.
 * @param path - state file under Electron's user-data directory.
 * @param state - placement captured before the window closes.
 */
export function saveDesktopWindowState(path: string, state: DesktopWindowState): void {
  mkdirSync(dirname(path), { recursive: true })
  const temporary = path + '.tmp'
  writeFileSync(temporary, JSON.stringify(state) + '\n', 'utf8')
  renameSync(temporary, path)
}
