/**
 * `dsh tui` — boot the builtin dsh-TUI terminal interface (the `dsh-tui`
 * profile). The launcher owns the profile seed and the TUI-specific argument
 * contract, mirroring the upstream `dsh-tui` bin without depending on pnpm:
 * the builtin plugin ships in the installation, so the profile is seeded from
 * the heal fallback instead of a registry `add`.
 * @module @deepseek-ai/dsh/tui
 */

import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import {
  healProfilesModuleFallback,
  initProfile,
  loadLayeredEnv,
  resolveBundleDir,
  resolveProfileDir,
} from '@deepseek-ai/dsh-app-boot'
import { INSTALL_ANCHOR, runProfile } from './profile-boot.ts'

const NAME = 'dsh'
const TUI_PROFILE = 'dsh-tui'
const TUI_PACKAGE = '@deepseek-harness-tui/dsh-tui'

/** The seeded bundle stack: the harness base plus the TUI's own patch layer. */
const TUI_BUNDLES: readonly string[] = ['@deepseek-ai/dsh-base', TUI_PACKAGE]

/** Resume.txt homes, newest first; the legacy name stays until old TUIs retire. */
const RESUME_DIRS: readonly string[] = ['.dsh-tui', '.dsh-cc']

/** Resume env names, written in parallel for the same transition window. */
const RESUME_ENV_NAMES: readonly string[] = ['DSH_TUI_RESUME_SESSION', 'DSH_CC_RESUME_SESSION'] as const

/** Env name the launcher uses for a positional workspace target. */
const WORKSPACE_TARGET_ENV = 'DSH_TUI_WORKSPACE_TARGET'

/** A provider URI the registry resolves (file paths resolve natively). */
const PROVIDER_URI = /^[a-z][a-z0-9+.-]*:\/\//iu

/** The dsh-tui profile directory under the Harness home. */
function tuiProfileDir(): string {
  return resolveProfileDir(TUI_PROFILE)
}

/**
 * Read the last resumed session id from resume.txt (new path first, legacy
 * fallback). A missing or empty record is a cold start, not an error.
 * @param home - the user home directory (injectable for tests).
 * @returns the recorded session id, or `''` when none is recorded.
 */
export function readLastResumeTarget(home = homedir()): string {
  for (const dir of RESUME_DIRS) {
    try {
      const sessionId = readFileSync(join(home, dir, 'resume.txt'), 'utf8').trim()
      if (sessionId !== '') return sessionId
    } catch {
      // No recorded session — a cold start is fine.
    }
  }
  return ''
}

/**
 * Filter TUI launcher syntax out of the inner arguments and feed the values
 * back through the environment:
 * - `--resume <id>` / `--resume=<id>` / `--resume` / `-c` / `--continue`
 *   select the session; bare forms fall back to resume.txt. The flag never
 *   reaches the booted app — the TUI reads the env pair instead.
 * - one positional workspace target (absolute path, provider URI, or an
 *   existing relative path) is consumed into DSH_TUI_WORKSPACE_TARGET when unset.
 * Everything else is passed through verbatim.
 * @param argv - arguments after `dsh tui`.
 * @param environment - the mutable environment (process.env in production).
 * @param home - the user home directory (injectable for tests).
 * @returns the arguments to hand the booted profile.
 */
export function interceptTuiArgs(
  argv: readonly string[],
  environment: Record<string, string | undefined>,
  home: string,
): string[] {
  const args: string[] = []
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index] ?? ''
    if (argument === '--resume' || argument === '-c' || argument === '--continue' || argument.startsWith('--resume=')) {
      let sessionId = ''
      if (argument.startsWith('--resume=')) {
        sessionId = argument.slice('--resume='.length).trim()
      } else if (argument === '--resume') {
        const next = argv[index + 1]
        if (next !== undefined && !next.startsWith('-')) sessionId = (argv[++index] ?? '').trim()
      }
      if (sessionId === '') sessionId = readLastResumeTarget(home)
      if (sessionId !== '') {
        for (const name of RESUME_ENV_NAMES) environment[name] = sessionId
      }
    } else if (
      environment[WORKSPACE_TARGET_ENV] === undefined
      && !argument.startsWith('-')
      && (isAbsolute(argument) || PROVIDER_URI.test(argument) || existsSync(resolve(argument)))
    ) {
      environment[WORKSPACE_TARGET_ENV] = argument
    } else {
      args.push(argument)
    }
  }
  return args
}

/**
 * Seed the `dsh-tui` profile on first use. The profile manifest is written
 * exactly like `dsh plugin add` would leave it: the base bundle plus the TUI
 * bundle in the layer list. Re-running on an initialized profile is a no-op.
 * @param dir - the profile directory (injectable for tests).
 */
export function seedTuiProfile(dir: string): void {
  if (!existsSync(join(dir, 'package.json'))) initProfile(dir, TUI_BUNDLES)
}

/**
 * Seed the `dsh-tui` profile and prove the TUI bundle resolves. Resolution
 * fails loud when the builtin package is absent (a source checkout).
 */
export function ensureTuiProfile(): void {
  const dir = tuiProfileDir()
  seedTuiProfile(dir)
  resolveBundleDir(NAME, TUI_PACKAGE, INSTALL_ANCHOR, dir)
}

/**
 * Boot the dsh-TUI profile with the launcher-filtered inner arguments.
 * @param argv - arguments after `dsh tui`.
 */
export async function runTui(argv: readonly string[]): Promise<void> {
  healProfilesModuleFallback(INSTALL_ANCHOR)
  ensureTuiProfile()
  // React dev builds accumulate unbounded performance buffers over long
  // sessions; the TUI ships production-rendered (same as the upstream bin).
  process.env.NODE_ENV ??= 'production'
  const args = interceptTuiArgs(argv, process.env, homedir())
  await runProfile({
    environment: loadLayeredEnv(NAME),
    profile: TUI_PROFILE,
    patchFiles: [],
    args,
  })
}
