/** Build the production desktop Host tree from release tarballs and a verified Node runtime. */

import { createHash } from 'node:crypto'
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { isEntry, run } from '../release/process.ts'
import { packedDependencies } from '../release/tarball.ts'

/** Standard Node release pinned for the Windows x64 desktop product. */
export const DESKTOP_NODE_VERSION = '24.19.0'

/** Official Node distribution origin; a mirror may be selected through the environment. */
const DEFAULT_NODE_DIST_BASE = 'https://nodejs.org/dist'

/** One installed production dependency recorded in desktop release metadata. */
export interface DesktopInstalledPackage {
  name: string
  version: string
  license: string
}

/** Normalize one package.json license field for the release inventory. */
function packageLicense(value: unknown): string {
  if (typeof value === 'string' && value.length > 0) return value
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return 'UNKNOWN'
  const type = (value as Record<string, unknown>).type
  return typeof type === 'string' && type.length > 0 ? type : 'UNKNOWN'
}

/** Add package manifests from one installed node_modules tree. */
function collectInstalledPackages(nodeModules: string, packages: Map<string, DesktopInstalledPackage>): void {
  if (!existsSync(nodeModules)) return
  const addPackage = (directory: string): void => {
    const manifestPath = join(directory, 'package.json')
    if (!existsSync(manifestPath)) return
    const value: unknown = JSON.parse(readFileSync(manifestPath, 'utf8'))
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw new Error(`desktop runtime: ${manifestPath} is not a package manifest`)
    }
    const manifest = value as Record<string, unknown>
    if (typeof manifest.name !== 'string' || typeof manifest.version !== 'string') {
      throw new Error(`desktop runtime: ${manifestPath} omits name or version`)
    }
    const item = { name: manifest.name, version: manifest.version, license: packageLicense(manifest.license) }
    packages.set(`${item.name}@${item.version}`, item)
    collectInstalledPackages(join(directory, 'node_modules'), packages)
  }
  for (const entry of readdirSync(nodeModules, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === '.bin') continue
    const directory = join(nodeModules, entry.name)
    if (entry.name.startsWith('@')) {
      for (const scoped of readdirSync(directory, { withFileTypes: true })) {
        if (scoped.isDirectory()) addPackage(join(directory, scoped.name))
      }
    } else {
      addPackage(directory)
    }
  }
}

/**
 * Inventory unique production package name/version pairs from an installed tree.
 * @param output - staged desktop runtime root.
 * @returns sorted dependency records suitable for release metadata.
 */
export function installedPackageInventory(output: string): readonly DesktopInstalledPackage[] {
  const packages = new Map<string, DesktopInstalledPackage>()
  collectInstalledPackages(join(output, 'node_modules'), packages)
  return [...packages.values()].sort((left, right) => (
    left.name.localeCompare(right.name) || left.version.localeCompare(right.version)
  ))
}

/** Read one response body or fail with its HTTP status. */
async function fetchBytes(url: string): Promise<Buffer> {
  const response = await fetch(url, { signal: AbortSignal.timeout(300_000) })
  if (!response.ok) throw new Error(`desktop runtime: GET ${url} returned ${String(response.status)}`)
  return Buffer.from(await response.arrayBuffer())
}

/** Resolve one filename's SHA-256 from the signed release checksum listing. */
export function expectedChecksum(listing: string, filename: string): string {
  for (const line of listing.split('\n')) {
    const [checksum, listed] = line.trim().split(/\s+/u)
    if (listed === filename && checksum !== undefined && /^[0-9a-f]{64}$/u.test(checksum)) return checksum
  }
  throw new Error(`desktop runtime: SHASUMS256.txt has no entry for ${filename}`)
}

/** Assert the staged dependency tree contains no links or junctions. */
function assertLinkFree(root: string, current = root): void {
  for (const entry of readdirSync(current, { withFileTypes: true })) {
    const path = join(current, entry.name)
    const stat = lstatSync(path)
    if (stat.isSymbolicLink()) {
      throw new Error(`desktop runtime: link is forbidden: ${relative(root, path)}`)
    }
    if (entry.isDirectory()) assertLinkFree(root, path)
  }
}

/** Run a TypeScript release command through the repository's declared source launcher. */
function runReleaseScript(root: string, script: string, args: readonly string[]): void {
  run(process.execPath, ['--import', 'tsx/esm', script, ...args], { cwd: root })
}

/** Pack both npm release families into deterministic staging inputs. */
function packReleaseInputs(root: string, packedRoot: string): readonly string[] {
  const vendor = join(packedRoot, 'vendor')
  const dsh = join(packedRoot, 'dsh')
  runReleaseScript(root, './scripts/release/pack.ts', ['--family', 'vendor', '--out', relative(root, vendor)])
  runReleaseScript(root, './scripts/release/pack.ts', ['--family', 'dsh', '--out', relative(root, dsh)])
  return [vendor, dsh]
}

/** Download, checksum, and extract the pinned Windows x64 Node distribution. */
async function stageNodeRuntime(output: string, version: string, baseUrl: string): Promise<string> {
  const release = `v${version}`
  const filename = `node-${release}-win-x64.zip`
  const releaseUrl = `${baseUrl.replace(/\/$/u, '')}/${release}`
  const [archive, checksumBytes] = await Promise.all([
    fetchBytes(`${releaseUrl}/${filename}`),
    fetchBytes(`${releaseUrl}/SHASUMS256.txt`),
  ])
  const expected = expectedChecksum(checksumBytes.toString('utf8'), filename)
  const actual = createHash('sha256').update(archive).digest('hex')
  if (actual !== expected) throw new Error(`desktop runtime: ${filename} SHA-256 mismatch`)

  const temporary = join(dirname(output), '.node-runtime')
  const archivePath = join(temporary, filename)
  rmSync(temporary, { recursive: true, force: true })
  mkdirSync(temporary, { recursive: true })
  writeFileSync(archivePath, archive)
  run('tar', ['-xf', archivePath, '-C', temporary])

  const extracted = join(temporary, `node-${release}-win-x64`)
  if (!existsSync(join(extracted, 'node.exe'))) {
    throw new Error(`desktop runtime: ${filename} did not contain node.exe`)
  }
  rmSync(output, { recursive: true, force: true })
  renameSync(extracted, output)
  rmSync(temporary, { recursive: true, force: true })
  return actual
}

/**
 * One builtin out-of-tree plugin shipped with the desktop runtime, pinned to a
 * published npm release. The runtime installs the plugin into its node_modules
 * so the profile heal symlinks it into `$DSH_HOME/profiles/node_modules`, the
 * plugin inventory lists it as installed, and any profile can mount it with a
 * bare plugin row.
 */
export interface BuiltinPluginSpec {
  readonly name: string
  readonly version: string
}

/** The out-of-tree plugins the desktop product ships as builtins. */
export const BUILTIN_PLUGINS: readonly BuiltinPluginSpec[] = [
  { name: '@deepseek-harness-tui/dsh-tui', version: '0.8.6' },
  { name: '@linxin666/dsh-web-ui-all', version: '0.2.5' },
  { name: '@nanmicoder/dsh-agent-teams', version: '0.1.8' },
  { name: 'dsh-at-file', version: '0.6.3' },
]

/** Registry spec for one builtin plugin: npm resolves a bare version from the registry. */
export function builtinDependencySpec(plugin: BuiltinPluginSpec): string {
  return plugin.version
}

/**
 * npm `overrides` pinned on the staged runtime manifest so the React tree stays
 * single-instance. dsh-tui declares react ^19.2.0 while the web UI plugins bring
 * react ^18 to the same tree; without the override npm nests react 19 under
 * dsh-tui, the hoisted usehooks-ts resolves react 18, and the reconciler (react
 * 19) and the components (react 18) disagree on the hook dispatcher, crashing
 * with "Cannot read properties of null (reading 'useRef')". The only React
 * consumer that renders in the Node runtime is dsh-tui; browser-side plugins
 * receive react from the web build, so pinning 19.2.0 is safe for the whole
 * staged tree.
 */
export const BUILTIN_REACT_OVERRIDES: Readonly<Record<string, string>> = {
  react: '19.2.0',
  'react-dom': '19.2.0',
}

/** The package directory name under node_modules for one package name. */
function packageDirectoryName(name: string): string {
  const scoped = name.split('/')
  return scoped.length === 2 ? join(scoped[0] ?? '', scoped[1] ?? '') : name
}

/**
 * Merge the packed workspace tarball map with the builtin registry plugins into
 * one runtime manifest dependencies object. Packed tarballs win on name
 * collisions: a workspace package is never shadowed by a builtin spec.
 */
export function runtimeDependencies(
  packed: ReadonlyMap<string, { url: string; version: string }>,
): Record<string, string> {
  return {
    ...Object.fromEntries(BUILTIN_PLUGINS.map(plugin => [plugin.name, builtinDependencySpec(plugin)])),
    ...Object.fromEntries([...packed].map(([name, item]) => [name, item.url])),
  }
}

/**
 * Add the builtin plugins to an installed `@deepseek-ai/dsh` manifest so the
 * profile heal's dependency closure covers them. The heal BFS walks the app
 * manifest's `dependencies`, so without this patch the plugins would install
 * into the runtime yet stay invisible to profiles.
 * @param manifest - the installed CLI package manifest (mutated copy returned).
 * @returns the manifest with the builtin specs merged into `dependencies`.
 */
export function addBuiltinDependencies<T extends { dependencies?: Record<string, string> }>(
  manifest: T,
): T & { dependencies: Record<string, string> } {
  return {
    ...manifest,
    dependencies: {
      ...manifest.dependencies,
      ...Object.fromEntries(BUILTIN_PLUGINS.map(plugin => [plugin.name, builtinDependencySpec(plugin)])),
    },
  }
}

/** Install packed Harness artifacts with the exact Node runtime that will execute them. */
function stageHarnessDependencies(output: string, packedDirectories: readonly string[]): Map<string, { url: string; version: string }> {
  const packed = packedDependencies(packedDirectories)
  const cli = packed.get('@deepseek-ai/dsh')
  if (cli === undefined) throw new Error('desktop runtime: packed inputs omit @deepseek-ai/dsh')

  const manifest = {
    name: '@deepseek-ai/dsh-desktop-runtime',
    version: cli.version,
    private: true,
    dependencies: runtimeDependencies(packed),
    overrides: BUILTIN_REACT_OVERRIDES,
  }
  writeFileSync(join(output, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`)

  const node = join(output, 'node', 'node.exe')
  const npm = join(output, 'node', 'node_modules', 'npm', 'bin', 'npm-cli.js')
  const environment = { ...process.env }
  delete environment.NODE_OPTIONS
  delete environment.NODE_PATH
  run(node, [npm, 'install', '--no-audit', '--no-fund', '--package-lock=false'], { cwd: output, env: environment })

  // The heal walks the CLI app's manifest, not the runtime root, so the
  // builtin plugins must appear in the installed CLI package's dependencies to
  // reach profiles. npm resolves them from the registry at install time; this
  // patch only records them in the app manifest for the heal's BFS.
  const cliManifestPath = join(output, 'node_modules', '@deepseek-ai', 'dsh', 'package.json')
  const cliManifest: unknown = JSON.parse(readFileSync(cliManifestPath, 'utf8'))
  if (typeof cliManifest !== 'object' || cliManifest === null || Array.isArray(cliManifest)) {
    throw new Error('desktop runtime: installed CLI manifest is not an object')
  }
  writeFileSync(
    cliManifestPath,
    `${JSON.stringify(addBuiltinDependencies(cliManifest as { dependencies?: Record<string, string> }), null, 2)}\n`,
  )

  writeFileSync(join(output, 'package.json'), `${JSON.stringify({
    name: manifest.name,
    version: manifest.version,
    private: true,
  }, null, 2)}\n`)
  return packed
}

/** Prove the staged tree runs through bundled Node and includes its native Windows dependencies. */
function verifyRuntime(output: string, version: string): void {
  const node = join(output, 'node', 'node.exe')
  const cli = join(output, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
  const desktopHost = join(output, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'desktop-host.js')
  if (!existsSync(desktopHost)) throw new Error('desktop runtime: packed CLI omits lib/desktop-host.js')
  run(node, [cli, '--version'], { cwd: output })
  run(node, [
    '--input-type=module',
    '--eval',
    "await Promise.all(['node-pty', 'sharp', 'koffi', 'esbuild'].map(name => import(name)))",
  ], { cwd: output })

  const reported = readFileSync(join(output, 'package.json'), 'utf8')
  if (!reported.includes(`"version": "${version}"`)) {
    throw new Error('desktop runtime: staged package version does not match packed CLI')
  }
  for (const plugin of BUILTIN_PLUGINS) {
    if (!existsSync(join(output, 'node_modules', packageDirectoryName(plugin.name)))) {
      throw new Error(`desktop runtime: builtin plugin ${plugin.name}@${plugin.version} is not installed`)
    }
  }
  assertLinkFree(output)
}

/** Read the exact Electron version from the desktop package manifest. */
function desktopElectronVersion(root: string): string {
  const value: unknown = JSON.parse(readFileSync(join(root, 'apps', 'desktop', 'package.json'), 'utf8'))
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('desktop runtime: apps/desktop/package.json is not an object')
  }
  const devDependencies = (value as Record<string, unknown>).devDependencies
  if (typeof devDependencies !== 'object' || devDependencies === null || Array.isArray(devDependencies)) {
    throw new Error('desktop runtime: desktop package omits devDependencies')
  }
  const electron = (devDependencies as Record<string, unknown>).electron
  if (typeof electron !== 'string' || !/^\d+\.\d+\.\d+$/u.test(electron)) {
    throw new Error('desktop runtime: Electron must use an exact release version')
  }
  return electron
}

/** Write the packaged dependency and license index retained beside the Host tree. */
function writeThirdPartyNotices(
  output: string,
  nodeVersion: string,
  electronVersion: string,
  dependencies: readonly DesktopInstalledPackage[],
): void {
  const lines = [
    'DeepSeek Harness Desktop production dependency license index',
    '',
    `Node.js ${nodeVersion} - see node/LICENSE`,
    `Electron ${electronVersion} - see the installed Electron LICENSE`,
    '',
    ...dependencies.map(item => `${item.name} ${item.version} - ${item.license}`),
  ]
  writeFileSync(join(output, 'THIRD_PARTY_NOTICES.txt'), `${lines.join('\n')}\n`)
}

/** The OpenPets unpacked build's executable name (productName's executableName). */
const OPENPETS_EXECUTABLE = 'openpets.exe'

/** The OpenPets unpacked output directory relative to its workspace root. */
const OPENPETS_UNPACKED_RELATIVE = join('apps', 'desktop', 'dist-electron', 'win-unpacked')

/** The fallback note written when OpenPets cannot be bundled; the native pet stays. */
function openpetsFallbackNote(message: string): string {
  return ['OpenPets companion app is not bundled in this build: ' + message, 'The desktop app keeps its native pet window.', ''].join(String.fromCharCode(10))
}

/**
 * Stage the bundled OpenPets companion app beside the runtime. The packaged
 * desktop shell launches it as the pet when present and falls back to the
 * native pet window otherwise. Staging must never fail the whole desktop
 * release: a missing or unbuildable source keeps the native pet with an
 * honest fallback note.
 * @param outputRoot - the directory beside resources/harness (Electron extraResources root).
 * @param sourceDir - the OpenPets workspace checkout, or undefined to skip.
 */
export function stageOpenpets(outputRoot: string, sourceDir: string | undefined): void {
  const target = join(outputRoot, 'openpets')
  rmSync(target, { recursive: true, force: true })
  mkdirSync(target, { recursive: true })
  if (sourceDir === undefined || !existsSync(join(sourceDir, 'package.json'))) {
    writeFileSync(join(target, 'README.txt'), openpetsFallbackNote('no OpenPets source was provided (DSH_OPENPETS_SOURCE)'))
    console.log('desktop runtime: OpenPets companion source missing; keeping the native pet')
    return
  }
  const unpacked = join(sourceDir, OPENPETS_UNPACKED_RELATIVE)
  if (!existsSync(join(unpacked, OPENPETS_EXECUTABLE))) {
    try {
      run('pnpm', ['--filter', '@open-pets/desktop', 'package:dir'], { cwd: sourceDir })
    } catch (error) {
      writeFileSync(join(target, 'README.txt'), openpetsFallbackNote(error instanceof Error ? error.message : String(error)))
      console.warn('desktop runtime: OpenPets build failed; keeping the native pet')
      return
    }
  }
  if (!existsSync(join(unpacked, OPENPETS_EXECUTABLE))) {
    writeFileSync(join(target, 'README.txt'), openpetsFallbackNote('the OpenPets build produced no openpets.exe'))
    console.warn('desktop runtime: OpenPets build produced no openpets.exe; keeping the native pet')
    return
  }
  cpSync(unpacked, target, { recursive: true })
  console.log('desktop runtime: bundled OpenPets companion at ' + target)
}

/** Stage the complete resources/harness directory consumed by Electron Builder. */
async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      'node-version': { type: 'string', default: DESKTOP_NODE_VERSION },
      output: { type: 'string', default: 'apps/desktop/dist/desktop-runtime' },
      'packed-output': { type: 'string', default: 'dist/desktop-npm' },
    },
    allowPositionals: false,
  })
  const root = process.cwd()
  const output = resolve(root, values.output)
  const packedRoot = resolve(root, values['packed-output'])
  const baseUrl = process.env.DSH_NODE_DIST_BASE ?? DEFAULT_NODE_DIST_BASE
  const openpetsSource = process.env.DSH_OPENPETS_SOURCE

  rmSync(output, { recursive: true, force: true })
  mkdirSync(output, { recursive: true })
  const packedDirectories = packReleaseInputs(root, packedRoot)
  const checksum = await stageNodeRuntime(join(output, 'node'), values['node-version'], baseUrl)
  const packed = stageHarnessDependencies(output, packedDirectories)
  const cli = packed.get('@deepseek-ai/dsh')
  if (cli === undefined) throw new Error('desktop runtime: staged package map omits @deepseek-ai/dsh')
  verifyRuntime(output, cli.version)
  const electronVersion = desktopElectronVersion(root)
  stageOpenpets(dirname(output), openpetsSource === '' ? undefined : openpetsSource)
  const dependencies = installedPackageInventory(output)
  writeThirdPartyNotices(output, values['node-version'], electronVersion, dependencies)
  writeFileSync(join(output, 'desktop-runtime.json'), `${JSON.stringify({
    target: { platform: 'win32', arch: 'x64' },
    node: { version: values['node-version'], sha256: checksum },
    electronVersion,
    harnessVersion: cli.version,
    workspacePackages: Object.fromEntries([...packed].map(([name, item]) => [name, item.version])),
    dependencies,
  }, null, 2)}\n`)
  console.log(`desktop runtime: staged ${String(packed.size)} packages and Node ${values['node-version']} at ${output}`)
}

if (isEntry(import.meta.url)) await main()
