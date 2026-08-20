/** Host-owned plugin catalog and profile package mutation Remote. */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import {
  readProfileManifest,
  resolveBundleDir,
  resolveProfileDir,
  writeProfileManifest,
  type ProfileManifest,
} from '@deepseek-ai/dsh-app-boot'
import type {} from '@deepseek-ai/dsh-subprocess'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type {} from 'zod'
import { installSpec, listMarketplace, resolveMarketplaceEntry } from './catalog.ts'
import { PLUGIN_MARKETPLACE_DEFAULT_PAGE_SIZE } from './types.ts'
import type {
  PluginMarketplaceListRequest,
  PluginMarketplaceMutationRequest,
  PluginMarketplaceMutationResult,
  PluginMarketplaceProgress,
  PluginMarketplaceSnapshot,
} from './types.ts'

export type * from './types.ts'

const DEFAULT_REQUEST_TIMEOUT_MS = 15_000
const DEFAULT_RESPONSE_MAX_BYTES = 2 * 1024 * 1024
const DEFAULT_OPERATION_TIMEOUT_MS = 300_000
const DEFAULT_MAX_ENTRIES = 24
const DEFAULT_OUTPUT_MAX_BYTES = 64 * 1024
const DEFAULT_GRACE_MS = 5_000

/** Plugin marketplace deployment configuration. */
export interface Config {
  /** Existing profile whose dependencies and bundle layers are managed. */
  profile: string
  /** Executable that dispatches the pnpm command. */
  packageManagerExecutable?: string
  /** Deadline for each external provider request. */
  requestTimeoutMs?: number
  /** Maximum complete body size for each provider response. */
  responseMaxBytes?: number
  /** Deadline for one package-manager mutation. */
  operationTimeoutMs?: number
  /** Maximum catalog entries retained from one listing. */
  maxEntries?: number
  /** Collected byte limit for each package-manager output stream. */
  outputMaxBytes?: number
  /** Process termination and output-drain grace period. */
  graceMs?: number
}

type ResolvedConfig = Required<Config>

function diagnostics(stdout: string, stderr: string): string {
  return [stderr.trim(), stdout.trim()].filter(Boolean).join('\n').slice(-4_000)
}

/** Host Remote that owns external discovery and serialized profile writes. */
export class PluginMarketplaceGateway extends TypertRemoteService {
  static inject = ['subprocess']

  static Config: z<Config> = z.object({
    profile: z.string().required(),
    packageManagerExecutable: z.string().default('corepack'),
    requestTimeoutMs: z.natural().min(1).default(DEFAULT_REQUEST_TIMEOUT_MS),
    responseMaxBytes: z.natural().min(1).default(DEFAULT_RESPONSE_MAX_BYTES),
    operationTimeoutMs: z.natural().min(1).default(DEFAULT_OPERATION_TIMEOUT_MS),
    maxEntries: z.natural().min(1).max(50).default(DEFAULT_MAX_ENTRIES),
    outputMaxBytes: z.natural().min(1).default(DEFAULT_OUTPUT_MAX_BYTES),
    graceMs: z.natural().min(1).default(DEFAULT_GRACE_MS),
  })

  private readonly config: ResolvedConfig
  private readonly profileDir: string
  private queue = Promise.resolve()
  private state: PluginMarketplaceProgress = {
    status: 'idle', operation: null, stage: 'idle', percent: 0, packageName: null, detail: null,
  }

  constructor(ctx: Context, config: Config) {
    super(ctx, 'pluginMarketplace')
    this.config = config as ResolvedConfig
    this.profileDir = resolveProfileDir(this.config.profile)
    readProfileManifest(this.config.profile, this.profileDir)
  }

  private reportProgress(update: Partial<PluginMarketplaceProgress>): void {
    this.state = { ...this.state, ...update }
  }

  private options(): { maxEntries: number; requestTimeoutMs: number; responseMaxBytes: number; userAgent: string } {
    return {
      maxEntries: this.config.maxEntries,
      requestTimeoutMs: this.config.requestTimeoutMs,
      responseMaxBytes: this.config.responseMaxBytes,
      userAgent: 'DeepSeek-Harness-Plugin-Marketplace',
    }
  }

  private profile(): ProfileManifest {
    return readProfileManifest(this.config.profile, this.profileDir)
  }

  private async serialized<T>(operation: () => Promise<T>): Promise<T> {
    const before = this.queue
    let release!: () => void
    this.queue = new Promise<void>((resolve) => { release = resolve })
    await before
    try {
      return await operation()
    } finally {
      release()
    }
  }

  private async pnpm(
    args: readonly string[],
    onOutput?: (detail: string, percent: number) => void,
  ): Promise<void> {
    const executable = await this.ctx.subprocess.resolveExecutable(this.config.packageManagerExecutable)
    const controller = new AbortController()
    const timer = setTimeout(() => { controller.abort(new Error('plugin package operation timed out')) },
      this.config.operationTimeoutMs)
    try {
      const handle = this.ctx.subprocess.spawn({
        argv: [executable, 'pnpm', ...args],
        cwd: this.profileDir,
        stdio: {
          stdin: 'ignore',
          stdout: { maxBytes: this.config.outputMaxBytes },
          stderr: { maxBytes: this.config.outputMaxBytes },
        },
        graceMs: this.config.graceMs,
        signal: controller.signal,
      })
      const started = Date.now()
      let stdout = ''
      let stderr = ''
      const poll = setInterval(() => {
        stdout = handle.collected.stdout?.readFrom(0).text ?? ''
        stderr = handle.collected.stderr?.readFrom(0).text ?? ''
        const elapsed = Date.now() - started
        const percent = Math.min(70, 20 + Math.floor(elapsed / this.config.operationTimeoutMs * 50))
        onOutput?.(diagnostics(stdout, stderr), percent)
      }, 500)
      let outcome: Awaited<typeof handle.done>
      try {
        outcome = await handle.done
      } finally {
        clearInterval(poll)
      }
      stdout = handle.collected.stdout?.readFrom(0).text ?? ''
      stderr = handle.collected.stderr?.readFrom(0).text ?? ''
      if (controller.signal.aborted) throw controller.signal.reason
      if (outcome.exitCode !== 0) throw new Error(diagnostics(stdout, stderr) || 'pnpm exited unsuccessfully')
    } finally {
      clearTimeout(timer)
    }
  }

  private activate(packageName: string): void {
    const manifest = this.profile()
    if (manifest.dependencies?.[packageName] === undefined) {
      throw new Error('installed dependency identity does not match marketplace package')
    }
    const dir = resolveBundleDir(this.config.profile, packageName, import.meta.filename, this.profileDir)
    const installed = readProfileManifest(packageName, dir)
    if (installed.dsh?.bundle?.patch === undefined) throw new Error('installed package declares no dsh.bundle')
    const bundles = manifest.dsh?.profile?.bundles ?? []
    bundles.push(packageName)
    manifest.dsh = { ...manifest.dsh, profile: { ...manifest.dsh?.profile, bundles } }
    writeProfileManifest(this.profileDir, manifest)
  }

  private deactivate(packageName: string): void {
    const manifest = this.profile()
    const bundles = manifest.dsh?.profile?.bundles
    if (bundles === undefined || !bundles.includes(packageName)) {
      throw new Error('installed plugin is absent from the profile bundle list')
    }
    const next = bundles.filter(item => item !== packageName)
    manifest.dsh = { ...manifest.dsh, profile: { ...manifest.dsh?.profile, bundles: next } }
    writeProfileManifest(this.profileDir, manifest)
  }

  /**
   * List one external provider and annotate entries from the current profile.
   * @param request - selected provider and bounded search text.
   * @returns normalized marketplace entries with installed state.
   */
  @Remote('list')
  async list(request: PluginMarketplaceListRequest): Promise<PluginMarketplaceSnapshot> {
    const result = await listMarketplace(
      request.source, request.query, this.profile(), this.options(),
      request.page ?? 1, request.pageSize ?? PLUGIN_MARKETPLACE_DEFAULT_PAGE_SIZE,
    )
    const pageSize = Math.min(Math.max(1, Math.floor(request.pageSize ?? PLUGIN_MARKETPLACE_DEFAULT_PAGE_SIZE)), this.config.maxEntries)
    const page = Math.max(1, Math.floor(request.page ?? 1))
    return {
      source: request.source, entries: result.entries, total: result.total,
      page, pages: Math.max(1, Math.ceil(result.total / pageSize)), restartRequired: false,
    }
  }

  /**
   * Return the live progress of the running mutation for the browser progress bar.
   * @returns the current progress snapshot.
   */
  @Remote('progress')
  async progress(): Promise<PluginMarketplaceProgress> {
    return this.state
  }

  /**
   * Install one provider-resolved plugin and activate its profile layer on restart.
   * @param request - provider identity selected from a marketplace listing.
   * @returns committed package state and the restart requirement.
   */
  @Remote('addPlugin')
  async addPlugin(request: PluginMarketplaceMutationRequest): Promise<PluginMarketplaceMutationResult> {
    return await this.serialized(async () => {
      this.reportProgress({ status: 'running', operation: 'install', stage: 'resolve', percent: 5, packageName: null, detail: null })
      try {
        const candidate = await resolveMarketplaceEntry(request.source, request.id, this.profile(), this.options())
        if (!candidate.installed) {
          this.reportProgress({ stage: 'install', percent: 15, packageName: candidate.packageName })
          await this.pnpm(['add', await installSpec(candidate, this.options())], (detail, percent) => {
            this.reportProgress({ stage: 'install', percent, detail })
          })
          this.reportProgress({ stage: 'activate', percent: 90 })
          try {
            this.activate(candidate.packageName)
          } catch (error) {
            try {
              await this.pnpm(['remove', candidate.packageName])
            } catch (rollbackError) {
              throw new AggregateError([error, rollbackError], 'plugin verification and dependency rollback both failed')
            }
            throw error
          }
          this.reportProgress({ stage: 'done', percent: 100 })
        }
        return { packageName: candidate.packageName, installed: true, restartRequired: true }
      } catch (error) {
        this.reportProgress({ stage: 'failed', detail: error instanceof Error ? error.message : String(error) })
        throw error
      } finally {
        this.reportProgress({
          status: 'idle', operation: null, stage: 'idle', percent: 0, packageName: null, detail: null,
        })
      }
    })
  }

  /**
   * Remove one provider-resolved plugin dependency and its profile layer.
   * @param request - provider identity selected from a marketplace listing.
   * @returns committed package state and the restart requirement.
   */
  @Remote('deletePlugin')
  async deletePlugin(request: PluginMarketplaceMutationRequest): Promise<PluginMarketplaceMutationResult> {
    return await this.serialized(async () => {
      this.reportProgress({ status: 'running', operation: 'remove', stage: 'resolve', percent: 5, packageName: null, detail: null })
      try {
        const candidate = await resolveMarketplaceEntry(request.source, request.id, this.profile(), this.options())
        if (candidate.installed) {
          this.reportProgress({ stage: 'install', percent: 40, packageName: candidate.packageName })
          await this.pnpm(['remove', candidate.packageName], (detail, percent) => {
            this.reportProgress({ stage: 'install', percent: 40 + percent / 2, detail })
          })
          this.reportProgress({ stage: 'activate', percent: 95 })
          this.deactivate(candidate.packageName)
          this.reportProgress({ stage: 'done', percent: 100 })
        }
        return { packageName: candidate.packageName, installed: false, restartRequired: true }
      } catch (error) {
        this.reportProgress({ stage: 'failed', detail: error instanceof Error ? error.message : String(error) })
        throw error
      } finally {
        this.reportProgress({
          status: 'idle', operation: null, stage: 'idle', percent: 0, packageName: null, detail: null,
        })
      }
    })
  }
}

export default PluginMarketplaceGateway
