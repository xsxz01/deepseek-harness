import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { initProfile, resolveProfileDir } from '@deepseek-ai/dsh-app-boot'
import type { SubprocessRuntime, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import { remoteMethods } from '@deepseek-ai/dsh-typert-protocol'
import PluginMarketplaceGateway from '../src/index.ts'
import type { PluginMarketplaceEntryId } from '../src/types.ts'

let home: string
let previousHome: string | undefined
let context: Context | undefined

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'dsh-marketplace-'))
  previousHome = process.env.DSH_HOME
  process.env.DSH_HOME = home
})

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (previousHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = previousHome
  await rm(home, { recursive: true, force: true })
  vi.unstubAllGlobals()
})

function catalog(): Response {
  return new Response(JSON.stringify({ total: 1, items: [{
    id: 'owner/plugin', name: 'plugin-package', displayName: 'Plugin package', description: 'Plugin',
    repoOwner: 'owner', repoName: 'plugin', npmPackageName: 'plugin-package', latestVersion: '1.0.0',
    stars: 2, hasBundle: true, isVerified: true,
  }] }))
}

function subprocess(profileDir: string, validBundle: boolean, calls: string[][], failRemove = false): SubprocessRuntime {
  return {
    async resolveExecutable(command: string) { expect(command).toBe('corepack'); return 'corepack-test' },
    spawn(spec: SubprocessSpawnSpec) {
      const args = [...spec.argv]
      calls.push(args)
      if (failRemove && args[2] === 'remove') {
        return {
          done: Promise.resolve({ exitCode: 1, signal: null }),
          collected: {
            stdout: { readFrom: () => ({ text: 'package manager failed' }) },
            stderr: { readFrom: () => ({ text: 'remove denied' }) },
          },
        } as never
      }
      const manifestPath = join(profileDir, 'package.json')
      const manifest = JSON.parse(requireText(manifestPath)) as { dependencies: Record<string, string> }
      if (args[2] === 'add') {
        manifest.dependencies['plugin-package'] = '1.0.0'
        writeFileSync(manifestPath, JSON.stringify(manifest, undefined, 2) + '\n')
        const bundleDir = join(profileDir, 'node_modules', 'plugin-package')
        mkdirSync(bundleDir, { recursive: true })
        const installedManifest = validBundle
          ? { name: 'plugin-package', dsh: { bundle: { patch: './cordis.patch.yml' } } }
          : { name: 'plugin-package' }
        writeFileSync(join(bundleDir, 'package.json'), JSON.stringify(installedManifest) + '\n')
      } else {
        delete manifest.dependencies['plugin-package']
        writeFileSync(manifestPath, JSON.stringify(manifest, undefined, 2) + '\n')
        rmSync(join(profileDir, 'node_modules', 'plugin-package'), { recursive: true, force: true })
      }
      return {
        done: Promise.resolve({ exitCode: 0, signal: null }),
        collected: {
          stdout: { readFrom: () => ({ text: '' }) },
          stderr: { readFrom: () => ({ text: '' }) },
        },
      } as never
    },
  } as unknown as SubprocessRuntime
}

function requireText(path: string): string {
  return readFileSync(path, 'utf8')
}

async function gateway(
  validBundle = true,
  failRemove = false,
): Promise<{ service: PluginMarketplaceGateway; profileDir: string; calls: string[][] }> {
  const profileDir = resolveProfileDir('market-test')
  initProfile(profileDir, [])
  const calls: string[][] = []
  context = new Context()
  context.provide('subprocess', subprocess(profileDir, validBundle, calls, failRemove))
  await context.plugin(PluginMarketplaceGateway, { profile: 'market-test', operationTimeoutMs: 5_000 }).await()
  const service = context.get('pluginMarketplace') as PluginMarketplaceGateway
  return { service, profileDir, calls }
}


async function gatewayWithRuntime(
  runtime: (profileDir: string) => SubprocessRuntime,
  config: Record<string, unknown> = {},
): Promise<{ service: PluginMarketplaceGateway; profileDir: string }> {
  const profileDir = resolveProfileDir('market-test')
  initProfile(profileDir, [])
  context = new Context()
  context.provide('subprocess', runtime(profileDir))
  await context.plugin(PluginMarketplaceGateway, { profile: 'market-test', operationTimeoutMs: 5_000, ...config }).await()
  return { service: context.get('pluginMarketplace') as PluginMarketplaceGateway, profileDir }
}

describe('PluginMarketplaceGateway profile transactions', () => {
  it('publishes list/add/delete methods and commits profile bundles after package success', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => catalog()))
    const { service, profileDir, calls } = await gateway()
    expect(remoteMethods(service)).toEqual([
      { method: 'list', invocation: { kind: 'direct' } },
      { method: 'progress', invocation: { kind: 'direct' } },
      { method: 'addPlugin', invocation: { kind: 'direct' } },
      { method: 'deletePlugin', invocation: { kind: 'direct' } },
    ])

    const request = { source: 'dsh' as const, id: 'owner/plugin' as PluginMarketplaceEntryId }
    await expect(service.list({ source: 'dsh', query: '' })).resolves.toEqual(expect.objectContaining({ source: 'dsh', total: 1, restartRequired: false }))
    const freshManifest = JSON.parse(await readFile(join(profileDir, 'package.json'), 'utf8')) as { dsh?: unknown }
    delete freshManifest.dsh
    writeFileSync(join(profileDir, 'package.json'), JSON.stringify(freshManifest, undefined, 2) + '\n')
    await expect(service.addPlugin(request)).resolves.toEqual({ packageName: 'plugin-package', installed: true, restartRequired: true })
    let manifest = JSON.parse(await readFile(join(profileDir, 'package.json'), 'utf8')) as { dsh: { profile: { bundles: string[] } } }
    expect(manifest.dsh.profile.bundles).toEqual(['plugin-package'])
    expect(calls[0]).toEqual(['corepack-test', 'pnpm', 'add', 'plugin-package@1.0.0'])
    await expect(service.addPlugin(request)).resolves.toEqual({ packageName: 'plugin-package', installed: true, restartRequired: true })
    expect(calls).toHaveLength(1)

    await expect(service.deletePlugin(request)).resolves.toEqual({ packageName: 'plugin-package', installed: false, restartRequired: true })
    manifest = JSON.parse(await readFile(join(profileDir, 'package.json'), 'utf8')) as typeof manifest
    expect(manifest.dsh.profile.bundles).toEqual([])
    expect(calls[1]).toEqual(['corepack-test', 'pnpm', 'remove', 'plugin-package'])
    await expect(service.deletePlugin(request)).resolves.toEqual({ packageName: 'plugin-package', installed: false, restartRequired: true })
    expect(calls).toHaveLength(2)
  })






  it('paginates listings and exposes live mutation progress through the Remote', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => catalog()))
    const release = Promise.withResolvers<{ exitCode: number; signal: null }>()
    const calls: string[][] = []
    const { service } = await gatewayWithRuntime((profileDir) => {
      const runtime = subprocess(profileDir, true, calls)
      const spawn = runtime.spawn.bind(runtime)
      return {
        resolveExecutable: runtime.resolveExecutable.bind(runtime),
        spawn(spec: SubprocessSpawnSpec) {
          const handle = spawn(spec)
          return { ...handle, done: release.promise }
        },
      } as SubprocessRuntime
    })
    const request = { source: 'dsh' as const, id: 'owner/plugin' as PluginMarketplaceEntryId }

    await expect(service.progress()).resolves.toEqual({
      status: 'idle', operation: null, stage: 'idle', percent: 0, packageName: null, detail: null,
    })
    const snapshot = await service.list({ source: 'dsh', query: '', page: 1, pageSize: 1 })
    expect(snapshot).toEqual(expect.objectContaining({
      page: 1, pages: 1, restartRequired: false,
      entries: [expect.objectContaining({ id: 'owner/plugin' })],
    }))

    const pending = service.addPlugin(request)
    await vi.waitFor(() => { expect(calls).toHaveLength(1) })
    await expect(service.progress()).resolves.toEqual(expect.objectContaining({
      status: 'running', operation: 'install', stage: 'install', packageName: 'plugin-package',
    }))
    release.resolve({ exitCode: 0, signal: null })
    await expect(pending).resolves.toEqual({ packageName: 'plugin-package', installed: true, restartRequired: true })
    await expect(service.progress()).resolves.toEqual({
      status: 'idle', operation: null, stage: 'idle', percent: 0, packageName: null, detail: null,
    })
  })

  it('fails loud when external profile edits invalidate resolved installed state', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => catalog()))
    const { service, profileDir } = await gateway()
    const request = { source: 'dsh' as const, id: 'owner/plugin' as PluginMarketplaceEntryId }
    await service.addPlugin(request)
    vi.stubGlobal('fetch', vi.fn(async () => {
      const manifest = JSON.parse(requireText(join(profileDir, 'package.json'))) as { dsh?: unknown }
      delete manifest.dsh
      writeFileSync(join(profileDir, 'package.json'), JSON.stringify(manifest, undefined, 2) + '\n')
      return catalog()
    }))
    await expect(service.deletePlugin(request)).rejects.toThrow('absent from the profile bundle list')
  })

  it('serializes concurrent mutations against the committed profile state', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => catalog()))
    const release = Promise.withResolvers<{ exitCode: number; signal: null }>()
    const calls: string[][] = []
    const { service } = await gatewayWithRuntime((profileDir) => {
      const runtime = subprocess(profileDir, true, calls)
      const spawn = runtime.spawn.bind(runtime)
      return {
        resolveExecutable: runtime.resolveExecutable.bind(runtime),
        spawn(spec: SubprocessSpawnSpec) {
          const handle = spawn(spec)
          return { ...handle, done: release.promise }
        },
      } as SubprocessRuntime
    })
    const request = { source: 'dsh' as const, id: 'owner/plugin' as PluginMarketplaceEntryId }
    const first = service.addPlugin(request)
    await vi.waitFor(() => { expect(calls).toHaveLength(1) })
    const second = service.addPlugin(request)
    await Promise.resolve()
    expect(calls).toHaveLength(1)
    release.resolve({ exitCode: 0, signal: null })
    await expect(Promise.all([first, second])).resolves.toEqual([
      { packageName: 'plugin-package', installed: true, restartRequired: true },
      { packageName: 'plugin-package', installed: true, restartRequired: true },
    ])
    expect(calls).toHaveLength(1)
  })

  it('bounds package operations and reports empty package-manager diagnostics', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => catalog()))
    const request = { source: 'dsh' as const, id: 'owner/plugin' as PluginMarketplaceEntryId }
    let state = await gatewayWithRuntime(() => ({
      async resolveExecutable() { return 'corepack-test' },
      spawn(spec: SubprocessSpawnSpec) {
        const signal = spec.signal
        if (signal === undefined) throw new Error('test subprocess requires a cancellation signal')
        return {
          done: new Promise((resolve) => { signal.addEventListener('abort', () => { resolve({ exitCode: 0, signal: null }) }) }),
          collected: {},
        } as never
      },
    }) as unknown as SubprocessRuntime, { operationTimeoutMs: 1 })
    await expect(state.service.addPlugin(request)).rejects.toThrow('timed out')
    await context?.fiber.dispose()
    context = undefined
    await rm(state.profileDir, { recursive: true, force: true })

    state = await gatewayWithRuntime(() => ({
      async resolveExecutable() { return 'corepack-test' },
      spawn() { return { done: Promise.resolve({ exitCode: 1, signal: null }), collected: {} } as never },
    }) as unknown as SubprocessRuntime)
    await expect(state.service.addPlugin(request)).rejects.toThrow('pnpm exited unsuccessfully')
  })

  it('rolls back when pnpm succeeds without the declared dependency identity', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => catalog()))
    const { service } = await gatewayWithRuntime(() => ({
      async resolveExecutable() { return 'corepack-test' },
      spawn() { return { done: Promise.resolve({ exitCode: 0, signal: null }), collected: {} } as never },
    }) as unknown as SubprocessRuntime)
    await expect(service.addPlugin({ source: 'dsh', id: 'owner/plugin' as PluginMarketplaceEntryId })).rejects.toThrow('dependency identity')
  })

  it('preserves package diagnostics and reports a failed verification rollback', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => catalog()))
    const request = { source: 'dsh' as const, id: 'owner/plugin' as PluginMarketplaceEntryId }

    let state = await gateway(true, true)
    await state.service.addPlugin(request)
    await expect(state.service.deletePlugin(request)).rejects.toThrow('remove denied\npackage manager failed')
    await context?.fiber.dispose()
    context = undefined
    await rm(state.profileDir, { recursive: true, force: true })

    state = await gateway(false, true)
    const error = await state.service.addPlugin(request).catch((value: unknown) => value)
    expect(error).toBeInstanceOf(AggregateError)
    expect((error as AggregateError).errors).toHaveLength(2)
  })

  it('rolls back a dependency that does not declare a bundle patch', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => catalog()))
    const { service, profileDir, calls } = await gateway(false)
    const request = { source: 'dsh' as const, id: 'owner/plugin' as PluginMarketplaceEntryId }
    await expect(service.addPlugin(request)).rejects.toThrow()
    const manifest = JSON.parse(await readFile(join(profileDir, 'package.json'), 'utf8')) as { dependencies: Record<string, string> }
    expect(manifest.dependencies).toEqual({})
    expect(calls.map(call => call[2])).toEqual(['add', 'remove'])
  })
})
