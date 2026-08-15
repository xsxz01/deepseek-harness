import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  loadDesktopWindowState,
  restoreDesktopWindowState,
  saveDesktopWindowState,
  type DesktopWindowState,
} from '../src/window-state.ts'

const temporaryDirectories: string[] = []

function statePath(): string {
  const directory = mkdtempSync(join(tmpdir(), 'dsh-desktop-window-'))
  temporaryDirectories.push(directory)
  const nested = join(directory, 'nested')
  mkdirSync(nested)
  return join(nested, 'window-state.json')
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('desktop window state', () => {
  const state: DesktopWindowState = {
    bounds: { x: 100, y: 80, width: 1200, height: 760 },
    maximized: false,
  }

  it('atomically persists and reloads validated placement', () => {
    const path = statePath()
    saveDesktopWindowState(path, state)
    expect(loadDesktopWindowState(path)).toEqual(state)
    expect(readFileSync(path, 'utf8')).toBe(JSON.stringify(state) + '\n')

    const replacement = { ...state, maximized: true }
    saveDesktopWindowState(path, replacement)
    expect(loadDesktopWindowState(path)).toEqual(replacement)
  })

  it('treats missing, malformed, and invalid state as absent', () => {
    const path = statePath()
    expect(loadDesktopWindowState(path)).toBeUndefined()

    writeFileSync(path, '{', 'utf8')
    expect(loadDesktopWindowState(path)).toBeUndefined()

    writeFileSync(path, JSON.stringify({ ...state, unexpected: true }), 'utf8')
    expect(loadDesktopWindowState(path)).toBeUndefined()

    writeFileSync(path, JSON.stringify({ bounds: { x: 0, y: 0, width: 100, height: 100 }, maximized: false }), 'utf8')
    expect(loadDesktopWindowState(path)).toBeUndefined()
  })

  it('keeps visible placement on its current display', () => {
    const restored = restoreDesktopWindowState(state, [
      { x: 0, y: 0, width: 1920, height: 1080 },
      { x: 1920, y: 0, width: 1920, height: 1080 },
    ])
    expect(restored).toEqual(state)
  })

  it('moves an offscreen window onto the primary display', () => {
    const restored = restoreDesktopWindowState({
      bounds: { x: 2500, y: 200, width: 1400, height: 900 },
      maximized: true,
    }, [{ x: 0, y: 0, width: 1920, height: 1040 }])
    expect(restored).toEqual({
      bounds: { x: 520, y: 140, width: 1400, height: 900 },
      maximized: true,
    })
  })

  it('fits oversized placement within the selected work area', () => {
    const restored = restoreDesktopWindowState({
      bounds: { x: -100, y: -50, width: 2400, height: 1400 },
      maximized: false,
    }, [{ x: 0, y: 0, width: 1600, height: 900 }])
    expect(restored?.bounds).toEqual({ x: 0, y: 0, width: 1600, height: 900 })
  })
})
