import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { pnpmInvocation } from './process.ts'

const temporaryDirectories: string[] = []

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'dsh-release-process-'))
  temporaryDirectories.push(directory)
  return directory
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('release process helpers', () => {
  it('runs pnpm through its inherited JavaScript entry without a platform shell', () => {
    expect(pnpmInvocation({ npm_execpath: 'C:\\tools\\pnpm.cjs' })).toEqual({
      command: process.execPath,
      args: ['C:\\tools\\pnpm.cjs'],
    })
  })

  it('falls back to Corepack beside the active Node executable', () => {
    const root = temporaryDirectory()
    const node = join(root, 'node.exe')
    const entry = join(root, 'node_modules', 'corepack', 'dist', 'pnpm.js')
    mkdirSync(join(root, 'node_modules', 'corepack', 'dist'), { recursive: true })
    writeFileSync(entry, '')
    expect(pnpmInvocation({}, node)).toEqual({ command: node, args: [entry] })
  })

  it('fails clearly without an inherited or Corepack pnpm entry', () => {
    const node = join(temporaryDirectory(), 'node.exe')
    expect(() => pnpmInvocation({}, node)).toThrow('pnpm JavaScript entry is unavailable')
  })
})
