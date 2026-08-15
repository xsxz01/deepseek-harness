import { describe, expect, it } from 'vitest'
import { DESKTOP_PET_SIZE, restoreDesktopPetPosition } from '../src/pet.ts'

describe('desktop pet placement', () => {
  const displays = [
    { x: 0, y: 0, width: 1200, height: 800 },
    { x: 1200, y: -100, width: 1000, height: 700 },
  ]

  it('uses the primary bottom-right corner for a new companion', () => {
    expect(restoreDesktopPetPosition(undefined, displays)).toEqual({
      x: 1200 - DESKTOP_PET_SIZE.width - 20,
      y: 800 - DESKTOP_PET_SIZE.height - 20,
    })
  })

  it('keeps a saved companion on its matching display', () => {
    expect(restoreDesktopPetPosition({ x: 1500, y: 100 }, displays)).toEqual({ x: 1500, y: 100 })
  })

  it('clamps an off-screen companion to the primary display', () => {
    expect(restoreDesktopPetPosition({ x: -600, y: 900 }, displays)).toEqual({ x: 0, y: 800 - DESKTOP_PET_SIZE.height })
  })
})
