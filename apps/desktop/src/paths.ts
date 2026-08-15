/** Runtime path resolution for source and packaged desktop launches. */

import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { createRequire } from 'node:module'

/** Executable and module paths used to fork the standard-Node Harness Host. */
export interface DesktopHostRuntime {
  execPath: string
  modulePath: string
}

/**
 * Resolve the standard-Node runtime and built Host child entry.
 * @param packaged - whether Electron is running from an installed artifact.
 * @param resourcesPath - Electron's immutable application resources root.
 * @param environment - launch environment used for the development Node override.
 * @returns validated executable and Host module paths.
 */
export function resolveDesktopHostRuntime(
  packaged: boolean,
  resourcesPath: string,
  environment: NodeJS.ProcessEnv = process.env,
): DesktopHostRuntime {
  const runtime = packaged
    ? {
      execPath: join(resourcesPath, 'harness', 'node', process.platform === 'win32' ? 'node.exe' : 'bin/node'),
      modulePath: join(resourcesPath, 'harness', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'desktop-host.js'),
    }
    : {
      execPath: environment.DSH_DESKTOP_NODE ?? environment.npm_node_execpath ?? 'node',
      modulePath: environment.DSH_DESKTOP_HOST_MODULE
        ?? createRequire(import.meta.url).resolve('@deepseek-ai/dsh/desktop-host'),
    }

  if (packaged && (!existsSync(runtime.execPath) || !existsSync(runtime.modulePath))) {
    throw new Error('desktop: packaged Harness runtime is incomplete')
  }
  return runtime
}
