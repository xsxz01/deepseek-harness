/** Write SHA-256 records for distributable desktop artifacts. */

import { createHash } from 'node:crypto'
import { createReadStream, readdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { isEntry } from '../release/process.ts'

const ARTIFACT_NAME = /^DeepSeek Harness-.+-x64(?:\.exe(?:\.blockmap)?|\.zip)$/u

/**
 * Hash one file without loading the complete installer into memory.
 * @param path - artifact path to read.
 * @returns lowercase SHA-256 digest.
 */
async function sha256(path: string): Promise<string> {
  const hash = createHash('sha256')
  await new Promise<void>((resolveHash, reject) => {
    const input = createReadStream(path)
    input.on('data', (chunk) => { hash.update(chunk) })
    input.once('end', resolveHash)
    input.once('error', reject)
  })
  return hash.digest('hex')
}

/**
 * Write sorted GNU-style checksums for the current desktop release artifacts.
 * @param directory - Electron Builder output directory.
 */
export async function writeArtifactChecksums(directory: string): Promise<void> {
  const names = readdirSync(directory).filter(name => ARTIFACT_NAME.test(name)).sort()
  if (names.length === 0) throw new Error('desktop artifacts: no release files found in ' + directory)
  const lines: string[] = []
  for (const name of names) lines.push((await sha256(join(directory, name))) + '  ' + name)
  writeFileSync(join(directory, 'SHA256SUMS.txt'), lines.join('\n') + '\n')
}

async function main(): Promise<void> {
  const { values } = parseArgs({ options: { directory: { type: 'string' } } })
  const directory = resolve(values.directory ?? 'apps/desktop/dist')
  await writeArtifactChecksums(directory)
  console.log('desktop artifacts: wrote SHA256SUMS.txt for ' + directory)
}

if (isEntry(import.meta.url)) await main()
