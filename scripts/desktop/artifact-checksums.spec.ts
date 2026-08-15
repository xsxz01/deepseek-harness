import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { writeArtifactChecksums } from './artifact-checksums.ts'

const directories: string[] = []

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('desktop artifact checksums', () => {
  it('writes sorted hashes for release files only', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'dsh-desktop-artifacts-'))
    directories.push(directory)
    mkdirSync(directory, { recursive: true })
    writeFileSync(join(directory, 'DeepSeek Harness-1-x64.zip'), 'zip')
    writeFileSync(join(directory, 'DeepSeek Harness-1-x64.exe'), 'installer')
    writeFileSync(join(directory, 'DeepSeek Harness-1-x64.exe.blockmap'), 'blockmap')
    writeFileSync(join(directory, 'DeepSeek Harness-1.__uninstaller.exe'), 'ignored')
    writeFileSync(join(directory, 'builder-debug.yml'), 'ignored')

    await writeArtifactChecksums(directory)

    expect(readFileSync(join(directory, 'SHA256SUMS.txt'), 'utf8')).toBe(
      digest('installer') + '  DeepSeek Harness-1-x64.exe\n'
      + digest('blockmap') + '  DeepSeek Harness-1-x64.exe.blockmap\n'
      + digest('zip') + '  DeepSeek Harness-1-x64.zip\n',
    )
  })
})
