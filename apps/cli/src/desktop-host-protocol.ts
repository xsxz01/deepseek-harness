/** Typed Node IPC protocol between the desktop supervisor and Harness Host child. */

/**
 * Events emitted by the desktop Harness Host child.
 * The ready `url` carries the Host's process launch token as its sole
 * authentication input: the Web server exchanges it for the browser cookie and
 * redirects to the clean `origin` ([browser-session auth]).
 * [browser-session auth]: ../../../packages/client/connection/src/browser-auth.ts
 */
export type DesktopHostEvent =
  | { type: 'ready'; origin: string; url: string; pid: number; version: string }
  | { type: 'fatal'; code: 'startup-failed' | 'invalid-composition'; message: string }
  | { type: 'stopping' }

/** Commands accepted by the desktop Harness Host child. */
export type DesktopHostCommand = { type: 'stop' }

/** Return whether a value is a non-array object with exactly the named keys. */
function hasKeys(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const actual = Object.keys(value).sort()
  return actual.length === keys.length && actual.every((key, index) => key === [...keys].sort()[index])
}

/**
 * Parse one supervisor command received over Node IPC.
 * @param value - untrusted IPC payload.
 * @returns the validated command.
 */
export function parseDesktopHostCommand(value: unknown): DesktopHostCommand {
  if (hasKeys(value, ['type']) && value.type === 'stop') return { type: 'stop' }
  throw new Error('desktop-host protocol: invalid command')
}

/**
 * Parse one Host event received over Node IPC.
 * @param value - untrusted IPC payload.
 * @returns the validated event.
 */
export function parseDesktopHostEvent(value: unknown): DesktopHostEvent {
  if (hasKeys(value, ['type']) && value.type === 'stopping') return { type: 'stopping' }
  if (hasKeys(value, ['type', 'code', 'message'])
    && value.type === 'fatal'
    && (value.code === 'startup-failed' || value.code === 'invalid-composition')
    && typeof value.message === 'string') {
    return { type: 'fatal', code: value.code, message: value.message }
  }
  if (hasKeys(value, ['type', 'origin', 'url', 'pid', 'version'])
    && value.type === 'ready'
    && typeof value.origin === 'string'
    && isLoopbackOrigin(value.origin)
    && typeof value.url === 'string'
    && isAuthenticatedLoopbackUrl(value.url, value.origin)
    && Number.isSafeInteger(value.pid)
    && (value.pid as number) > 0
    && typeof value.version === 'string'
    && value.version.length > 0) {
    return {
      type: 'ready',
      origin: value.origin,
      url: value.url,
      pid: value.pid as number,
      version: value.version,
    }
  }
  throw new Error('desktop-host protocol: invalid event')
}

/**
 * Validate the ready URL: the same loopback origin as `origin`, with exactly
 * the process launch token as its only query input.
 */
function isAuthenticatedLoopbackUrl(value: string, origin: string): boolean {
  try {
    const url = new URL(value)
    return url.origin === origin
      && url.searchParams.get('token') !== null
      && url.searchParams.size === 1
      && url.pathname === '/'
      && /^[A-Za-z0-9_-]{43}$/u.test(url.searchParams.get('token') ?? '')
  } catch {
    return false
  }
}

/** Validate one canonical dynamic-port loopback HTTP origin. */
function isLoopbackOrigin(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'http:'
      && url.hostname === '127.0.0.1'
      && Number(url.port) > 0
      && url.origin === value
  } catch {
    return false
  }
}
