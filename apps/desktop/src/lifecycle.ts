/** Race-safe lifecycle for one restartable desktop Host. */

/** Terminal reasons emitted by a supervised Host. */
export type DesktopLifecycleTermination =
  | { type: 'stopped' }
  | { type: 'unexpected-exit'; code: number | null; signal: NodeJS.Signals | null }
  | { type: 'protocol-error'; error: Error }

/** Immediate Host ownership required by the desktop lifecycle. */
export interface DesktopLifecycleHost {
  ready: Promise<unknown>
  done: Promise<DesktopLifecycleTermination>
  stop: () => Promise<void>
}

/** Dependencies that keep Electron and child-process details outside the state machine. */
export interface DesktopLifecycleDependencies<Host extends DesktopLifecycleHost> {
  startHost: () => Host
  showReady: (host: Host) => Promise<void>
  showFailure: (message: string, retry: () => void) => Promise<void>
}

/** Stable lifecycle phases observable by tests and desktop integration. */
export type DesktopLifecyclePhase = 'idle' | 'starting' | 'running' | 'failed' | 'stopping' | 'stopped'

/** Convert an unknown startup failure into a stable user-facing diagnostic. */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Own one Host generation at a time and discard stale completion callbacks. */
export class DesktopLifecycle<Host extends DesktopLifecycleHost> {
  readonly #dependencies: DesktopLifecycleDependencies<Host>
  #generation = 0
  #host: Host | undefined
  #phase: DesktopLifecyclePhase = 'idle'
  #transition: Promise<void> = Promise.resolve()

  /**
   * Create a lifecycle owner without starting the Host.
   * @param dependencies - Host construction and desktop presentation operations.
   */
  constructor(dependencies: DesktopLifecycleDependencies<Host>) {
    this.#dependencies = dependencies
  }

  /** Current lifecycle phase. */
  get phase(): DesktopLifecyclePhase {
    return this.#phase
  }

  /** Restart the Host after the active renderer terminates unexpectedly. */
  rendererFailed(message: string): void {
    if (this.#phase !== 'running') return
    const generation = ++this.#generation
    const host = this.#host
    this.#host = undefined
    this.#phase = 'failed'
    this.#transition = (async () => {
      try {
        await host?.stop()
      } catch (error) {
        message += ' Host shutdown also failed: ' + errorMessage(error)
      }
      if (generation !== this.#generation) return
      await this.#dependencies.showFailure(message, () => { this.#retry() })
    })()
  }

  /** Start the first Host generation; repeated calls share the active transition. */
  start(): Promise<void> {
    if (this.#phase !== 'idle') return this.#transition
    this.#transition = this.#startGeneration()
    return this.#transition
  }

  /** Stop the current or concurrently starting Host and reject later retries. */
  stop(): Promise<void> {
    if (this.#phase === 'stopped' || this.#phase === 'stopping') return this.#transition
    const host = this.#host
    this.#host = undefined
    this.#phase = 'stopping'
    this.#generation += 1
    this.#transition = (async () => {
      await host?.stop()
      this.#phase = 'stopped'
    })()
    return this.#transition
  }

  /** Start a new generation only from the retryable failure phase. */
  #retry(): void {
    if (this.#phase !== 'failed') return
    this.#transition = this.#startGeneration()
  }

  /** Start and present one Host generation. */
  async #startGeneration(): Promise<void> {
    const generation = ++this.#generation
    this.#phase = 'starting'
    let host: Host | undefined
    try {
      host = this.#dependencies.startHost()
      this.#host = host
      void host.done.then((termination) => { this.#hostDone(generation, termination) })
      await host.ready
      if (generation !== this.#generation) return
      await this.#dependencies.showReady(host)
      if (generation !== this.#generation) return
      this.#phase = 'running'
    } catch (error) {
      if (generation !== this.#generation) return
      await host?.stop()
      this.#host = undefined
      this.#phase = 'failed'
      await this.#dependencies.showFailure(errorMessage(error), () => { this.#retry() })
    }
  }

  /** Move a live generation to its retryable terminal state. */
  #hostDone(generation: number, termination: DesktopLifecycleTermination): void {
    if (generation !== this.#generation || termination.type === 'stopped') return
    this.#generation += 1
    this.#host = undefined
    this.#phase = 'failed'
    const message = termination.type === 'protocol-error'
      ? termination.error.message
      : 'The Harness Host exited unexpectedly (code '
        + String(termination.code) + ', signal ' + String(termination.signal) + ').'
    this.#transition = this.#dependencies.showFailure(message, () => { this.#retry() })
  }
}
