import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const desktopRoot = join(import.meta.dirname, '..')
const assets = join(desktopRoot, 'assets')
const pathScript = join(assets, 'cli-path.ps1')

function updatePath(action: 'Add' | 'Remove', directory: string, path: string): string {
  const systemRoot = process.env.SystemRoot ?? 'C:\Windows'
  const executable = join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  const result = spawnSync(executable, [
    '-NoLogo',
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    pathScript,
    '-Action',
    action,
    '-Directory',
    directory,
    '-Target',
    'Process',
    '-InitialPath',
    path,
  ], { encoding: 'utf8' })
  if (result.status !== 0) throw new Error(result.stderr)
  return result.stdout.trim()
}

describe('installed desktop CLI', () => {
  it('wires the wrapper and PATH hooks into NSIS packaging', () => {
    const builder = readFileSync(join(desktopRoot, 'electron-builder.yml'), 'utf8')
    const installer = readFileSync(join(desktopRoot, 'build', 'installer.nsh'), 'utf8')
    expect(builder).toContain('from: assets/dsh.cmd')
    expect(builder).toContain('include: build/installer.nsh')
    expect(installer).toContain('!macro customInstall')
    expect(installer).toContain('!macro customUnInstall')
    expect(installer).toContain('-Action Add -Directory')
    expect(installer).toContain('-Action Remove -Directory')
  })

  it('forwards every argument through the bundled standard Node runtime', () => {
    const wrapper = readFileSync(join(assets, 'dsh.cmd'), 'utf8')
    expect(wrapper).toContain(String.raw`%~dp0resources\harness\node\node.exe`)
    expect(wrapper).toContain(String.raw`%~dp0resources\harness\node_modules\@deepseek-ai\dsh\lib\bin.js`)
    expect(wrapper).toContain('%*')
    expect(wrapper).toContain('exit /b %ERRORLEVEL%')
  })
})

describe.runIf(process.platform === 'win32')('installed desktop CLI PATH registration', () => {
  const installDirectory = String.raw`C:\Program Files\DeepSeek Harness`

  it('adds the install directory once with case-insensitive normalization', () => {
    expect(updatePath('Add', installDirectory, String.raw`C:\Windows;C:\Tools`)).toBe(
      String.raw`C:\Windows;C:\Tools;C:\Program Files\DeepSeek Harness`,
    )
    expect(updatePath('Add', installDirectory, String.raw`C:\Windows;c:\program files\deepseek harness` + '\\')).toBe(
      String.raw`C:\Windows;C:\Program Files\DeepSeek Harness`,
    )
  })

  it('preserves unrelated empty PATH segments exactly', () => {
    const original = String.raw`C:\Windows;;C:\Tools;`
    const added = updatePath('Add', installDirectory, original)
    expect(added).toBe(original + ';' + installDirectory)
    expect(updatePath('Remove', installDirectory, added)).toBe(original)
  })

  it('removes only the registered install directory', () => {
    expect(updatePath('Remove', installDirectory, String.raw`C:\Windows;C:\Program Files\DeepSeek Harness;C:\Tools`)).toBe(
      String.raw`C:\Windows;C:\Tools`,
    )
  })
})
