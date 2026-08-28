#!/usr/bin/env node
/** Dedicated standard-Node child entry supervised by the Electron desktop application. */

/* v8 ignore file -- the built child-process acceptance suite exercises this entry. */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { loadLayeredEnv } from '@deepseek-ai/dsh-app-boot'
import {
  parseDesktopHostCommand,
  type DesktopHostEvent,
} from './desktop-host-protocol.ts'
import { runProfile, type RunProfileOptions } from './profile-boot.ts'

/** This installation's package version. */
function readVersion(): string {
  const manifest = JSON.parse(
    readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'),
  ) as { version?: unknown }
  if (typeof manifest.version !== 'string') throw new Error('desktop-host: package version is missing')
  return manifest.version
}

/** Send one event and wait until Node has accepted it for IPC delivery. */
async function sendEvent(event: DesktopHostEvent): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    if (process.send === undefined || !process.connected) {
      reject(new Error('desktop-host: supervisor IPC channel is unavailable'))
      return
    }
    process.send(event, (error) => {
      if (error === null) resolve()
      else reject(error)
    })
  })
}

/** Return a stable, non-secret startup diagnostic. */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Boot and serve the authenticated desktop Host until its supervisor stops it. */
async function main(): Promise<void> {
  if (process.send === undefined || !process.connected) {
    throw new Error('desktop-host: an active Node IPC channel is required')
  }

  const stopRequested = new AbortController()
  let stopPromise: Promise<void> | undefined
  let active: Awaited<ReturnType<typeof runProfile>> | undefined

  const stop = (): Promise<void> => {
    stopRequested.abort()
    if (active === undefined) return Promise.resolve()
    stopPromise ??= (async () => {
      if (process.connected) {
        try {
          await sendEvent({ type: 'stopping' })
        } catch (error) {
          console.error('desktop-host: failed to report stopping: ' + errorMessage(error))
        }
      }
      try {
        await active.shutdown.shutdown(typeof process.exitCode === 'number' ? process.exitCode : 0)
      } catch (error) {
        console.error('desktop-host: shutdown failed: ' + errorMessage(error))
        process.exitCode = 1
      }
    })()
    return stopPromise
  }

  process.on('message', (value: unknown) => {
    try {
      parseDesktopHostCommand(value)
      void stop()
    } catch (error) {
      console.error(errorMessage(error))
      process.exitCode = 1
      void stop()
    }
  })
  process.once('disconnect', () => { void stop() })

  const options: RunProfileOptions = {
    environment: loadLayeredEnv('dsh'),
    profile: 'web',
    patchFiles: [],
    // Electron loads the authenticated Host URL itself; the desktop process must never hand it to an external browser.
    args: ['--host', '127.0.0.1', '--port', '0'],
    invocationPatches: [{
      id: 'web-runtime',
      config: { printUrl: false, surfaceContext: true, trustedHosts: [] },
    }],
  }

  try {
    active = await runProfile(options)
    if (stopRequested.signal.aborted) {
      await stop()
      return
    }
    const webServer = active.ctx.get('webServer')
    if (webServer === undefined || webServer.host !== '127.0.0.1' || webServer.port <= 0) {
      await sendEvent({
        type: 'fatal',
        code: 'invalid-composition',
        message: 'desktop-host: WebServer did not publish a dynamic loopback origin',
      })
      await active.shutdown.shutdown(1)
      return
    }
    const origin = 'http://127.0.0.1:' + String(webServer.port)
    const connection = active.ctx.get('connection') as { authenticatedUrl(baseUrl: string): string } | undefined
    if (connection === undefined) {
      await sendEvent({
        type: 'fatal',
        code: 'invalid-composition',
        message: 'desktop-host: Web runtime did not publish browser-session authentication',
      })
      await active.shutdown.shutdown(1)
      return
    }
    await sendEvent({
      type: 'ready',
      origin,
      url: connection.authenticatedUrl(origin),
      pid: process.pid,
      version: readVersion(),
    })
  } catch (error) {
    try {
      await sendEvent({ type: 'fatal', code: 'startup-failed', message: errorMessage(error) })
    } catch (sendError) {
      console.error('desktop-host: failed to report startup failure: ' + errorMessage(sendError))
    }
    process.exitCode = 1
  }
}

await main().catch((error: unknown) => {
  console.error(errorMessage(error))
  process.exitCode = 1
})
