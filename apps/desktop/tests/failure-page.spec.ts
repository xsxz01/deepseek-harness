import { describe, expect, it } from 'vitest'
import {
  DESKTOP_RETRY_URL,
  desktopFailureDocument,
  desktopStartingDocument,
} from '../src/failure-page.ts'

function decodeDocument(url: string): string {
  return decodeURIComponent(url.slice(url.indexOf(',') + 1))
}

describe('desktop local status documents', () => {
  it('uses a CSP-restricted document without renderer script authority', () => {
    const html = decodeDocument(desktopStartingDocument())
    expect(html).toContain("default-src 'none'")
    expect(html).not.toContain('<script')
    expect(html).toContain('Starting Harness Host...')
  })

  it('escapes diagnostics and exposes only the reserved retry navigation', () => {
    const html = decodeDocument(desktopFailureDocument('<img src=x onerror=alert(1)> & "failed"'))
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt; &amp; &quot;failed&quot;')
    expect(html).not.toContain('<img')
    expect(html).toContain('href="' + DESKTOP_RETRY_URL + '"')
    expect(html).not.toContain('<script')
  })
})
