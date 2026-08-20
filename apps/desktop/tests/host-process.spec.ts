import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { startDesktopHost } from '../src/host-process.ts'

const fixture = (name: string): string => fileURLToPath(new URL('./fixtures/' + name, import.meta.url))

describe('desktop Host process supervisor', () => {
  it('prepends the selected Node distribution to the Host PATH', async () => {
    const host = startDesktopHost({
      runtime: { execPath: process.execPath, modulePath: fixture('host-environment.mjs') },
      environment: { PATH: 'fixture-tail', DSH_TEST_NODE_DIR: dirname(process.execPath) },
      startupTimeoutMs: 5_000,
      shutdownTimeoutMs: 5_000,
    })
    try {
      await expect(host.ready).resolves.toMatchObject({ type: 'ready' })
    } finally {
      await host.stop()
    }
  })

  it('publishes ownership before readiness and coalesces graceful stop', async () => {
    const host = startDesktopHost({
      runtime: { execPath: process.execPath, modulePath: fixture('host-ready.mjs') },
      startupTimeoutMs: 5_000,
      shutdownTimeoutMs: 5_000,
    })
    try {
      await expect(host.ready).resolves.toMatchObject({
        type: 'ready',
        origin: 'http://127.0.0.1:43123',
        cookie: { name: 'dsh-desktop-host' },
      })
    } finally {
      await Promise.all([host.stop(), host.stop()])
    }
    await expect(host.done).resolves.toEqual({ type: 'stopped' })
  })

  it('rejects malformed startup IPC without reporting an unexpected exit', async () => {
    const host = startDesktopHost({
      runtime: { execPath: process.execPath, modulePath: fixture('host-malformed.mjs') },
      startupTimeoutMs: 5_000,
      shutdownTimeoutMs: 25,
      forceTimeoutMs: 2_000,
    })
    await expect(host.ready).rejects.toThrow('invalid event')
    await host.stop()
    const termination = await host.done
    expect(termination.type).toBe('protocol-error')
    if (termination.type === 'protocol-error') expect(termination.error).toBeInstanceOf(Error)
  })

  it('enforces the startup deadline and remains stoppable while pending', async () => {
    const host = startDesktopHost({
      runtime: { execPath: process.execPath, modulePath: fixture('host-silent.mjs') },
      startupTimeoutMs: 25,
      shutdownTimeoutMs: 25,
      forceTimeoutMs: 2_000,
    })
    await expect(host.ready).rejects.toThrow('startup timed out')
    await host.stop()
    await expect(host.done).resolves.toEqual({ type: 'stopped' })
  })

  it('stops a pending Host before its startup deadline', async () => {
    const host = startDesktopHost({
      runtime: { execPath: process.execPath, modulePath: fixture('host-silent.mjs') },
      startupTimeoutMs: 5_000,
      shutdownTimeoutMs: 25,
      forceTimeoutMs: 2_000,
    })
    await host.stop()
    await expect(host.ready).rejects.toThrow('exited before readiness')
    await expect(host.done).resolves.toEqual({ type: 'stopped' })
  })

  it('publishes an unexpected exit after readiness', async () => {
    const host = startDesktopHost({
      runtime: { execPath: process.execPath, modulePath: fixture('host-crash.mjs') },
      startupTimeoutMs: 5_000,
    })
    await host.ready
    await expect(host.done).resolves.toMatchObject({ type: 'unexpected-exit', code: 7 })
  })

  it('terminates duplicate readiness as a protocol error', async () => {
    const host = startDesktopHost({
      runtime: { execPath: process.execPath, modulePath: fixture('host-duplicate-ready.mjs') },
      startupTimeoutMs: 5_000,
      forceTimeoutMs: 2_000,
    })
    await host.ready
    const termination = await host.done
    expect(termination.type).toBe('protocol-error')
    if (termination.type === 'protocol-error') {
      expect(termination.error.message).toBe('desktop: Harness Host sent duplicate readiness')
    }
  })
})
