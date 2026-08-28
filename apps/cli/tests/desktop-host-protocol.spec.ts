import { describe, expect, it } from 'vitest'
import {
  parseDesktopHostCommand,
  parseDesktopHostEvent,
  type DesktopHostEvent,
} from '../src/desktop-host-protocol.ts'

const TOKEN = 'A'.repeat(43)

function ready(overrides: Partial<Extract<DesktopHostEvent, { type: 'ready' }>> = {}): unknown {
  return {
    type: 'ready',
    origin: 'http://127.0.0.1:43123',
    url: 'http://127.0.0.1:43123/?token=' + TOKEN,
    pid: 1234,
    version: '0.1.0',
    ...overrides,
  }
}

describe('desktop Host IPC protocol', () => {
  it('accepts every command and event variant', () => {
    expect(parseDesktopHostCommand({ type: 'stop' })).toEqual({ type: 'stop' })
    expect(parseDesktopHostEvent({ type: 'stopping' })).toEqual({ type: 'stopping' })
    expect(parseDesktopHostEvent({ type: 'fatal', code: 'startup-failed', message: 'failed' }))
      .toEqual({ type: 'fatal', code: 'startup-failed', message: 'failed' })
    expect(parseDesktopHostEvent({ type: 'fatal', code: 'invalid-composition', message: 'missing server' }))
      .toEqual({ type: 'fatal', code: 'invalid-composition', message: 'missing server' })
    expect(parseDesktopHostEvent(ready())).toEqual(ready())
  })

  it.each([
    undefined,
    null,
    [],
    {},
    { type: 'stop', extra: true },
    { type: 'unknown' },
  ])('rejects invalid commands: %j', (value) => {
    expect(() => parseDesktopHostCommand(value)).toThrow('invalid command')
  })

  it.each([
    undefined,
    null,
    [],
    {},
    { type: 'stopping', extra: true },
    { type: 'fatal', code: 'other', message: 'failed' },
    { type: 'fatal', code: 'startup-failed' },
    ready({ origin: 'https://127.0.0.1:43123' }),
    ready({ origin: 'http://localhost:43123' }),
    ready({ origin: 'http://127.0.0.1' }),
    ready({ origin: 'http://127.0.0.1:0' }),
    ready({ origin: 'http://127.0.0.1:43123/path' }),
    ready({ url: 'http://127.0.0.1:43123/' }),
    ready({ url: 'http://127.0.0.1:43123/?token=short' }),
    ready({ url: 'http://127.0.0.1:43124/?token=' + TOKEN }),
    ready({ url: 'http://127.0.0.1:43123/?token=' + TOKEN + '&extra=1' }),
    ready({ url: 'https://127.0.0.1:43123/?token=' + TOKEN }),
    ready({ url: 'http://127.0.0.1:43123/path?token=' + TOKEN }),
    ready({ pid: 0 }),
    { ...ready() as object, extra: true },
  ])('rejects invalid events: %j', (value) => {
    expect(() => parseDesktopHostEvent(value)).toThrow('invalid event')
  })
})
