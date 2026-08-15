/** Pure navigation policy for the Electron renderer. */

import { isIP } from 'node:net'

/** Return whether Chromium resolved a hostname to a loopback identity. */
function isLoopbackHostname(value: string): boolean {
  const hostname = value.startsWith('[') && value.endsWith(']') ? value.slice(1, -1) : value
  const normalized = hostname.toLowerCase()
  if (normalized === 'localhost' || normalized.endsWith('.localhost')) return true
  if (isIP(normalized) === 4) return normalized.startsWith('127.')
  if (isIP(normalized) !== 6) return false
  return normalized === '::1' || /^::ffff:7f[0-9a-f]{2}:/u.test(normalized)
}

/** Result of applying the desktop navigation policy to one target URL. */
export type DesktopNavigationDecision = 'allow' | 'external' | 'deny'

/**
 * Classify a renderer navigation without granting another renderer process.
 * @param allowedOrigin - authenticated loopback origin owned by the active Host.
 * @param target - navigation target supplied by Chromium.
 * @returns whether to keep it in-window, open it externally, or deny it.
 */
export function decideDesktopNavigation(
  allowedOrigin: string,
  target: string,
): DesktopNavigationDecision {
  let url: URL
  try {
    url = new URL(target)
  } catch {
    return 'deny'
  }
  if (url.origin === allowedOrigin) return 'allow'
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return 'deny'
  if (isLoopbackHostname(url.hostname)) return 'deny'
  return 'external'
}
