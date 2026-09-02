/** Electron main process for DeepSeek Harness Desktop. */

import { join } from 'node:path'
import { app, dialog } from 'electron'
import { startDesktopHost, type DesktopHostController } from './host-process.ts'
import { DesktopLifecycle } from './lifecycle.ts'
import { resolveDesktopHostRuntime } from './paths.ts'
import { createDesktopWindow, type DesktopWindowShell } from './window.ts'

let desktopWindow: DesktopWindowShell | undefined
let lifecycle: DesktopLifecycle<DesktopHostController> | undefined
let quitPending = false

/** Stop the owned Host before re-entering Electron's quit sequence. */
function beginQuit(): void {
  if (quitPending) return
  quitPending = true
  void lifecycle?.stop().catch((error: unknown) => {
    dialog.showErrorBox(
      'DeepSeek Harness failed to stop cleanly',
      error instanceof Error ? error.message : String(error),
    )
  }).finally(() => { app.quit() })
}

/** Own the single desktop instance and its bounded Host lifecycle. */
async function main(): Promise<void> {
  // DSH_DESKTOP_USER_DATA re-roots the instance identity (Electron state and,
  // unless DSH_HOME is already set, the Harness home) so a packaged build can
  // run side by side with another install without sharing its profiles.
  const userDataOverride = process.env.DSH_DESKTOP_USER_DATA
  if (userDataOverride !== undefined) {
    app.setPath('userData', userDataOverride)
    if (process.env.DSH_HOME === undefined) {
      process.env.DSH_HOME = join(userDataOverride, 'harness-home')
    }
  }
  if (!app.requestSingleInstanceLock()) {
    app.quit()
    return
  }

  app.on('second-instance', () => {
    const window = desktopWindow?.window
    if (window === undefined) return
    if (window.isMinimized()) window.restore()
    window.show()
    window.focus()
  })
  app.on('window-all-closed', () => { app.quit() })
  app.on('before-quit', (event) => {
    if (lifecycle === undefined || lifecycle.phase === 'stopped') return
    event.preventDefault()
    beginQuit()
  })

  await app.whenReady()
  const runtime = resolveDesktopHostRuntime(app.isPackaged, process.resourcesPath)
  desktopWindow = await createDesktopWindow(
    join(app.getPath('userData'), 'window-state.json'),
    join(app.getPath('userData'), 'desktop-preferences.json'),
    (message) => { lifecycle?.rendererFailed(message) },
  )
  desktopWindow.window.once('closed', () => { desktopWindow = undefined })
  lifecycle = new DesktopLifecycle({
    startHost: () => startDesktopHost({ runtime }),
    showReady: async (host) => { await desktopWindow?.showHost(await host.ready) },
    showFailure: async (message, retry) => { await desktopWindow?.showFailure(message, retry) },
  })
  await lifecycle.start()
}

void main().catch(async (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  console.error(message)
  dialog.showErrorBox('DeepSeek Harness failed to start', message)
  await lifecycle?.stop().catch((stopError: unknown) => {
    console.error(stopError instanceof Error ? stopError.message : String(stopError))
  })
  app.quit()
})
