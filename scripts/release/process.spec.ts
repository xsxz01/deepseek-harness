import { describe, expect, it } from 'vitest'
import { attempt } from './process.ts'

describe('release process helpers', () => {
  it('captures a successful command result', () => {
    const result = attempt(process.execPath, ['-e', 'console.log("ok")'])
    expect(result.status).toBe(0)
    expect(result.stdout.trim()).toBe('ok')
  })

  it('reports a non-zero exit without throwing', () => {
    const result = attempt(process.execPath, ['-e', 'process.exit(3)'])
    expect(result.status).toBe(3)
  })

  it('throws on a spawn error', () => {
    expect(() => attempt('definitely-not-a-real-command-xyz', [])).toThrow()
  })
})
