import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { interceptTuiArgs, readLastResumeTarget, seedTuiProfile } from '../src/tui.ts'

const temporaryDirectories: string[] = []

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'dsh-tui-'))
  temporaryDirectories.push(directory)
  return directory
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('dsh tui launcher', () => {
  it('reads the last resume target from resume.txt, newest path first', () => {
    const home = temporaryDirectory()
    expect(readLastResumeTarget(home)).toBe('')
    const legacy = join(home, '.dsh-cc', 'resume.txt')
    mkdirSync(dirname(legacy), { recursive: true })
    writeFileSync(legacy, 'legacy-session\n')
    expect(readLastResumeTarget(home)).toBe('legacy-session')
    const current = join(home, '.dsh-tui', 'resume.txt')
    mkdirSync(dirname(current), { recursive: true })
    writeFileSync(current, 'current-session\n')
    expect(readLastResumeTarget(home)).toBe('current-session')
  })

  it('consumes resume forms and feeds the session id through both env names', () => {
    const environment: Record<string, string | undefined> = {}
    expect(interceptTuiArgs(['--resume', 'abc'], environment, temporaryDirectory())).toEqual([])
    expect(environment.DSH_TUI_RESUME_SESSION).toBe('abc')
    expect(environment.DSH_CC_RESUME_SESSION).toBe('abc')

    const equals = interceptTuiArgs(['--resume=def'], {}, temporaryDirectory())
    expect(equals).toEqual([])
  })

  it('falls back to resume.txt for the bare resume forms', () => {
    const home = temporaryDirectory()
    const recorded = join(home, '.dsh-tui', 'resume.txt')
    mkdirSync(dirname(recorded), { recursive: true })
    writeFileSync(recorded, 'recorded\n')
    for (const flag of ['--resume', '-c', '--continue']) {
      const environment: Record<string, string | undefined> = {}
      expect(interceptTuiArgs([flag], environment, home)).toEqual([])
      expect(environment.DSH_TUI_RESUME_SESSION).toBe('recorded')
    }
  })

  it('consumes one workspace target into the environment and passes everything else through', () => {
    const home = temporaryDirectory()
    const existing = join(home, 'workspace')
    mkdirSync(existing, { recursive: true })
    writeFileSync(join(existing, 'file.txt'), '')

    const environment: Record<string, string | undefined> = {}
    expect(interceptTuiArgs(['C:\\work', '--flag', 'arg'], environment, home)).toEqual(['--flag', 'arg'])
    expect(environment.DSH_TUI_WORKSPACE_TARGET).toBe('C:\\work')

    // A provider URI is a workspace target too.
    const uri: Record<string, string | undefined> = {}
    expect(interceptTuiArgs(['github://owner/repo'], uri, home)).toEqual([])
    expect(uri.DSH_TUI_WORKSPACE_TARGET).toBe('github://owner/repo')

    // An existing relative path resolves (against the process cwd); a first
    // target wins and later ones pass through.
    const relative: Record<string, string | undefined> = {}
    expect(interceptTuiArgs(['package.json', 'other'], relative, home)).toEqual(['other'])
    expect(relative.DSH_TUI_WORKSPACE_TARGET).toBe('package.json')

    // Ordinary positionals are profile arguments, not targets.
    const plain: Record<string, string | undefined> = {}
    expect(interceptTuiArgs(['hello world'], plain, home)).toEqual(['hello world'])
    expect(plain.DSH_TUI_WORKSPACE_TARGET).toBeUndefined()
  })

  it('seeds the dsh-tui profile once with the base and TUI bundle layers', () => {
    const dir = temporaryDirectory()
    seedTuiProfile(dir)
    const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as {
      dsh?: { profile?: { bundles?: string[] } }
      private?: boolean
    }
    expect(manifest.dsh?.profile?.bundles).toEqual(['@deepseek-ai/dsh-base', '@deepseek-harness-tui/dsh-tui'])
    // Re-seeding an initialized profile is a no-op.
    writeFileSync(join(dir, 'package.json'), '{"custom": true}')
    seedTuiProfile(dir)
    expect(JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))).toEqual({ custom: true })
  })
})
