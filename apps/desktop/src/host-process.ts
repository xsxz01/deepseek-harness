/** Supervision of the standard-Node Harness Host child process. */

import { fork, spawn, type ChildProcess } from 'node:child_process'
import type { Readable } from 'node:stream'
import {
  parseDesktopHostEvent,
  type DesktopHostEvent,
} from '@deepseek-ai/dsh/desktop-host-protocol'
import type { DesktopHostRuntime } from './paths.ts'

const DEFAULT_STARTUP_TIMEOUT_MS = 60_000
const DEFAULT_SHUTDOWN_TIMEOUT_MS = 7_000
const DEFAULT_FORCE_TIMEOUT_MS = 5_000

type ReadyEvent = Extract<DesktopHostEvent, { type: 'ready' }>

/** Options controlling one supervised Host process. */
export interface DesktopHostProcessOptions {
  runtime: DesktopHostRuntime
  environment?: NodeJS.ProcessEnv
  startupTimeoutMs?: number
  shutdownTimeoutMs?: number
  forceTimeoutMs?: number
}

/** Terminal reason for a Host generation after process termination. */
type DesktopHostTermination =
  | { type: 'stopped' }
  | { type: 'unexpected-exit'; code: number | null; signal: NodeJS.Signals | null }
  | { type: 'protocol-error'; error: Error }

/** Immediate ownership of a starting or running desktop Host. */
export interface DesktopHostController {
  ready: Promise<ReadyEvent>
  done: Promise<DesktopHostTermination>
  stop: () => Promise<void>
}

/** Pipe child diagnostics to the desktop process without interpreting their text. */
function forward(stream: Readable | null, target: NodeJS.WriteStream): void {
  stream?.on('data', (chunk: Buffer | string) => { target.write(chunk) })
}

/** Wait for a promise up to one bounded deadline. */
async function within<T>(promise: Promise<T>, timeoutMs: number): Promise<T | undefined> {
  let timer: NodeJS.Timeout | undefined
  const timeout = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => { resolve(undefined) }, timeoutMs)
  })
  try {
    return await Promise.race([promise, timeout])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

/** Run taskkill without allowing the cleanup helper itself to block shutdown. */
async function taskkillProcessTree(pid: number, timeoutMs: number): Promise<void> {
  const killer = spawn('taskkill', ['/pid', String(pid), '/t', '/f'], {
    stdio: 'ignore',
    windowsHide: true,
  })
  const completed = new Promise<void>((resolve) => {
    killer.once('error', () => { resolve() })
    killer.once('exit', () => { resolve() })
  })
  if (await within(completed, timeoutMs) === undefined) killer.kill()
}

/** Terminate the complete owned process tree within the force deadline. */
async function terminateProcessTree(
  child: ChildProcess,
  terminated: Promise<{ code: number | null; signal: NodeJS.Signals | null }>,
  timeoutMs: number,
): Promise<void> {
  if (child.pid !== undefined && process.platform === 'win32') {
    await taskkillProcessTree(child.pid, timeoutMs)
  } else {
    child.kill('SIGKILL')
  }
  if (await within(terminated, timeoutMs) !== undefined) return
  child.kill('SIGKILL')
  if (await within(terminated, timeoutMs) === undefined) {
    throw new Error('desktop: Harness Host did not terminate after forced shutdown')
  }
}

/**
 * Fork a standard-Node Host and return ownership before readiness can settle.
 * @param options - runtime paths, deadlines, and child environment.
 * @returns a controller with readiness, terminal outcome, and idempotent bounded stop.
 */
export function startDesktopHost(options: DesktopHostProcessOptions): DesktopHostController {
  const child = fork(options.runtime.modulePath, [], {
    execPath: options.runtime.execPath,
    env: options.environment ?? process.env,
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  })
  forward(child.stdout, process.stdout)
  forward(child.stderr, process.stderr)

  let readySettled = false
  let readySeen = false
  let stopRequested = false
  let protocolError: Error | undefined
  let resolveReady!: (event: ReadyEvent) => void
  let rejectReady!: (error: Error) => void
  const ready = new Promise<ReadyEvent>((resolve, reject) => {
    resolveReady = resolve
    rejectReady = reject
  })

  let resolveTerminated!: (detail: { code: number | null; signal: NodeJS.Signals | null }) => void
  const terminated = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
    resolveTerminated = resolve
  })
  let resolveDone!: (termination: DesktopHostTermination) => void
  const done = new Promise<DesktopHostTermination>((resolve) => { resolveDone = resolve })
  let processSettled = false

  const failReadiness = (error: Error): void => {
    if (readySettled) return
    readySettled = true
    rejectReady(error)
  }

  const finishProcess = (code: number | null, signal: NodeJS.Signals | null): void => {
    if (processSettled) return
    processSettled = true
    const detail = { code, signal }
    resolveTerminated(detail)
    if (!readySettled) failReadiness(new Error('desktop: Harness Host exited before readiness'))
    if (protocolError !== undefined) resolveDone({ type: 'protocol-error', error: protocolError })
    else if (stopRequested || !readySeen) resolveDone({ type: 'stopped' })
    else resolveDone({ type: 'unexpected-exit', ...detail })
  }

  child.once('exit', finishProcess)
  child.once('close', finishProcess)
  child.once('error', (error) => { failReadiness(error) })

  const forceAfterProtocolError = (error: Error): void => {
    if (protocolError !== undefined || processSettled) return
    protocolError = error
    if (!readySettled) failReadiness(error)
    void terminateProcessTree(
      child,
      terminated,
      options.forceTimeoutMs ?? DEFAULT_FORCE_TIMEOUT_MS,
    ).catch((terminationError: unknown) => {
      console.error(terminationError instanceof Error ? terminationError.message : String(terminationError))
    })
  }

  child.on('message', (value: unknown) => {
    let event: DesktopHostEvent
    try {
      event = parseDesktopHostEvent(value)
    } catch (error) {
      forceAfterProtocolError(error instanceof Error ? error : new Error(String(error)))
      return
    }
    switch (event.type) {
      case 'ready':
        if (readySeen || readySettled) {
          forceAfterProtocolError(new Error('desktop: Harness Host sent duplicate readiness'))
          return
        }
        readySeen = true
        readySettled = true
        resolveReady(event)
        return
      case 'fatal':
        if (readySeen) {
          forceAfterProtocolError(new Error(event.message))
          return
        }
        failReadiness(new Error(event.message))
        return
      case 'stopping':
        if (!stopRequested) forceAfterProtocolError(new Error('desktop: Harness Host stopped without a request'))
        return
    }
  })

  const startupTimer = setTimeout(() => {
    failReadiness(new Error('desktop: Harness Host startup timed out'))
  }, options.startupTimeoutMs ?? DEFAULT_STARTUP_TIMEOUT_MS)
  void ready.finally(() => { clearTimeout(startupTimer) }).catch(() => {})

  let stopPromise: Promise<void> | undefined
  const stop = (): Promise<void> => {
    stopPromise ??= (async () => {
      stopRequested = true
      if (processSettled) return
      if (child.connected) {
        try {
          child.send({ type: 'stop' }, (error) => {
            if (error !== null) console.error('desktop: failed to send Host stop command: ' + error.message)
          })
        } catch (error) {
          console.error('desktop: failed to send Host stop command: '
            + (error instanceof Error ? error.message : String(error)))
        }
      }
      const graceful = await within(terminated, options.shutdownTimeoutMs ?? DEFAULT_SHUTDOWN_TIMEOUT_MS)
      if (graceful !== undefined) return
      await terminateProcessTree(child, terminated, options.forceTimeoutMs ?? DEFAULT_FORCE_TIMEOUT_MS)
    })()
    return stopPromise
  }

  return { ready, done, stop }
}
