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
    cookie: { name: 'dsh-desktop-host', value: TOKEN },
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
    ready({ cookie: { name: 'other-cookie', value: TOKEN } }),
    ready({ cookie: { name: 'dsh-desktop-host', value: 'short' } }),
    ready({ pid: 0 }),
    { ...ready() as object, extra: true },
  ])('rejects invalid events: %j', (value) => {
    expect(() => parseDesktopHostEvent(value)).toThrow('invalid event')
  })
})
