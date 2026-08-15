import { describe, expect, it, vi } from 'vitest'
import { DesktopLifecycle, type DesktopLifecycleTermination } from '../src/lifecycle.ts'

interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (error: unknown) => void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

interface TestHost {
  id: number
  ready: Promise<void>
  done: Promise<DesktopLifecycleTermination>
  stop: ReturnType<typeof vi.fn<() => Promise<void>>>
}

function host(id: number, options: { ready?: Promise<void>; done?: Promise<DesktopLifecycleTermination> } = {}): TestHost {
  return {
    id,
    ready: options.ready ?? Promise.resolve(),
    done: options.done ?? new Promise(() => {}),
    stop: vi.fn(async () => {}),
  }
}

async function settle(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

describe('desktop lifecycle', () => {
  it('starts one Host and coalesces repeated start calls', async () => {
    const running = host(1)
    const startHost = vi.fn(() => running)
    const showReady = vi.fn(async () => {})
    const lifecycle = new DesktopLifecycle({
      startHost,
      showReady,
      showFailure: vi.fn(async () => {}),
    })

    await Promise.all([lifecycle.start(), lifecycle.start()])
    expect(lifecycle.phase).toBe('running')
    expect(startHost).toHaveBeenCalledOnce()
    expect(showReady).toHaveBeenCalledWith(running)
  })

  it('presents startup failure and retries with a new generation', async () => {
    const failed = host(1, { ready: Promise.reject(new Error('profile failed')) })
    const recovered = host(2)
    const startHost = vi.fn().mockReturnValueOnce(failed).mockReturnValueOnce(recovered)
    let retry: (() => void) | undefined
    const showFailure = vi.fn(async (_message: string, callback: () => void) => { retry = callback })
    const lifecycle = new DesktopLifecycle({
      startHost,
      showReady: vi.fn(async () => {}),
      showFailure,
    })

    await lifecycle.start()
    expect(lifecycle.phase).toBe('failed')
    expect(failed.stop).toHaveBeenCalledOnce()
    expect(showFailure).toHaveBeenCalledWith('profile failed', expect.any(Function))

    retry?.()
    await settle()
    expect(lifecycle.phase).toBe('running')
    expect(startHost).toHaveBeenCalledTimes(2)
  })

  it('turns an unexpected exit into a retryable failure', async () => {
    const completion = deferred<DesktopLifecycleTermination>()
    const first = host(1, { done: completion.promise })
    const second = host(2)
    const startHost = vi.fn().mockReturnValueOnce(first).mockReturnValueOnce(second)
    let retry: (() => void) | undefined
    const showFailure = vi.fn(async (_message: string, callback: () => void) => { retry = callback })
    const lifecycle = new DesktopLifecycle({
      startHost,
      showReady: vi.fn(async () => {}),
      showFailure,
    })

    await lifecycle.start()
    completion.resolve({ type: 'unexpected-exit', code: 7, signal: null })
    await settle()
    expect(lifecycle.phase).toBe('failed')
    expect(showFailure).toHaveBeenCalledWith(
      'The Harness Host exited unexpectedly (code 7, signal null).',
      expect.any(Function),
    )

    retry?.()
    await settle()
    expect(lifecycle.phase).toBe('running')
    expect(startHost).toHaveBeenCalledTimes(2)
  })

  it('stops and replaces the Host after renderer termination', async () => {
    const first = host(1)
    const second = host(2)
    const startHost = vi.fn().mockReturnValueOnce(first).mockReturnValueOnce(second)
    let retry: (() => void) | undefined
    const showFailure = vi.fn(async (_message: string, callback: () => void) => { retry = callback })
    const lifecycle = new DesktopLifecycle({
      startHost,
      showReady: vi.fn(async () => {}),
      showFailure,
    })

    await lifecycle.start()
    lifecycle.rendererFailed('renderer crashed')
    await settle()
    expect(lifecycle.phase).toBe('failed')
    expect(first.stop).toHaveBeenCalledOnce()
    expect(showFailure).toHaveBeenCalledWith('renderer crashed', expect.any(Function))

    retry?.()
    await settle()
    expect(lifecycle.phase).toBe('running')
    expect(startHost).toHaveBeenCalledTimes(2)
  })

  it('stops a Host whose readiness is still pending', async () => {
    const readiness = deferred<boolean>()
    const startingHost = host(1, { ready: readiness.promise.then(() => {}) })
    const lifecycle = new DesktopLifecycle({
      startHost: vi.fn(() => startingHost),
      showReady: vi.fn(async () => {}),
      showFailure: vi.fn(async () => {}),
    })

    const starting = lifecycle.start()
    const stopping = lifecycle.stop()
    readiness.reject(new Error('stopped'))
    await Promise.all([starting, stopping])
    expect(lifecycle.phase).toBe('stopped')
    expect(startingHost.stop).toHaveBeenCalledOnce()
  })

  it('does not wait for a failed renderer presentation during shutdown', async () => {
    const running = host(1)
    const presentation = deferred<boolean>()
    const lifecycle = new DesktopLifecycle({
      startHost: vi.fn(() => running),
      showReady: vi.fn(async () => {}),
      showFailure: vi.fn(async () => { await presentation.promise }),
    })

    await lifecycle.start()
    lifecycle.rendererFailed('renderer crashed')
    await settle()
    await lifecycle.stop()
    expect(lifecycle.phase).toBe('stopped')
    presentation.resolve(true)
  })

  it('stops a running Host exactly once', async () => {
    const running = host(1)
    const lifecycle = new DesktopLifecycle({
      startHost: vi.fn(() => running),
      showReady: vi.fn(async () => {}),
      showFailure: vi.fn(async () => {}),
    })

    await lifecycle.start()
    await Promise.all([lifecycle.stop(), lifecycle.stop()])
    expect(lifecycle.phase).toBe('stopped')
    expect(running.stop).toHaveBeenCalledOnce()
  })
})
