import { describe, expect, it } from 'vitest'
import { decideDesktopNavigation } from '../src/navigation.ts'

describe('desktop navigation policy', () => {
  const origin = 'http://127.0.0.1:43123'

  it('keeps only the authenticated Host origin in the renderer', () => {
    expect(decideDesktopNavigation(origin, origin + '/sessions/1')).toBe('allow')
  })

  it('denies every other loopback origin', () => {
    expect(decideDesktopNavigation(origin, 'http://127.0.0.1:43124/')).toBe('deny')
    expect(decideDesktopNavigation(origin, 'http://127.42.0.1:43123/')).toBe('deny')
    expect(decideDesktopNavigation(origin, 'http://localhost:43123/')).toBe('deny')
    expect(decideDesktopNavigation(origin, 'http://service.localhost:43123/')).toBe('deny')
    expect(decideDesktopNavigation(origin, 'http://[::1]:43123/')).toBe('deny')
    expect(decideDesktopNavigation(origin, 'http://[::ffff:7f00:1]:43123/')).toBe('deny')
  })

  it('opens external HTTP targets outside Electron', () => {
    expect(decideDesktopNavigation(origin, 'https://example.com/docs')).toBe('external')
  })

  it('denies malformed and non-HTTP targets', () => {
    expect(decideDesktopNavigation(origin, 'not a url')).toBe('deny')
    expect(decideDesktopNavigation(origin, 'file:///C:/secret.txt')).toBe('deny')
    expect(decideDesktopNavigation(origin, 'javascript:alert(1)')).toBe('deny')
  })
})
