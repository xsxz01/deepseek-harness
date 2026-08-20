/** Sandboxed Electron window for the authenticated loopback Harness origin. */

import { BrowserWindow, screen, shell, type Event } from 'electron'
import type { DesktopHostEvent } from '@deepseek-ai/dsh/desktop-host-protocol'
import {
  DESKTOP_RETRY_URL,
  desktopFailureDocument,
  desktopStartingDocument,
} from './failure-page.ts'
import { desktopShellScript, parseDesktopAction, readDesktopShellStyle } from './desktop-ui.ts'
import { decideDesktopNavigation } from './navigation.ts'
import { launchOpenpets, openpetsExecutable } from './openpets.ts'
import { createDesktopPet, type DesktopPetController } from './pet.ts'
import { loadDesktopPreferences, saveDesktopPreferences } from './preferences.ts'
import {
  DESKTOP_WINDOW_MINIMUM,
  loadDesktopWindowState,
  restoreDesktopWindowState,
  saveDesktopWindowState,
} from './window-state.ts'

type ReadyEvent = Extract<DesktopHostEvent, { type: 'ready' }>

/** Long-lived desktop window that can present successive Host generations. */
export interface DesktopWindowShell {
  window: BrowserWindow
  showHost: (ready: ReadyEvent) => Promise<void>
  showFailure: (message: string, retry: () => void) => Promise<void>
}

/** Open a remote URL without letting a rejected system-shell request escape an event handler. */
function openExternal(target: string): void {
  void shell.openExternal(target).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error))
  })
}

/**
 * Create one sandboxed desktop window that survives Host restarts.
 * @param statePath - durable placement file under Electron's user-data directory.
 * @param onRendererFailure - observer that restarts the Host after renderer termination.
 * @returns window ownership and operations for ready and failed Host states.
 */
export async function createDesktopWindow(
  statePath: string,
  preferencesPath: string,
  onRendererFailure: (message: string) => void,
): Promise<DesktopWindowShell> {
  const workAreas = screen.getAllDisplays().map(display => display.workArea)
  const restored = restoreDesktopWindowState(loadDesktopWindowState(statePath), workAreas)
  let preferences = loadDesktopPreferences(preferencesPath)
  const window = new BrowserWindow({
    width: restored?.bounds.width ?? 1280,
    height: restored?.bounds.height ?? 820,
    ...(restored === undefined ? {} : { x: restored.bounds.x, y: restored.bounds.y }),
    minWidth: DESKTOP_WINDOW_MINIMUM.width,
    minHeight: DESKTOP_WINDOW_MINIMUM.height,
    show: false,
    frame: false,
    autoHideMenuBar: true,
    backgroundColor: '#1b1b1a',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  let allowedOrigin: string | undefined
  let retryAction: (() => void) | undefined
  const session = window.webContents.session
  session.setPermissionCheckHandler(() => false)
  session.setPermissionRequestHandler((_webContents, _permission, callback) => { callback(false) })
  session.on('will-download', (event) => { event.preventDefault() })

  const shellStyle = readDesktopShellStyle()
  let pet: DesktopPetController | undefined
  let petCreation: Promise<DesktopPetController> | undefined
  const persistPreferences = (): void => {
    try {
      saveDesktopPreferences(preferencesPath, preferences)
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error))
    }
  }
  const shellState = () => ({
    petEnabled: preferences.pet.enabled,
    maximized: window.isMaximized(),
  })
  const refreshShell = async (): Promise<void> => {
    if (window.isDestroyed() || window.webContents.isDestroyed()) return
    await window.webContents.executeJavaScript(desktopShellScript(shellState()))
  }
  const refreshShellSafely = (): void => {
    void refreshShell().catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error))
    })
  }
  const installShell = async (): Promise<void> => {
    await window.webContents.insertCSS(shellStyle)
    await refreshShell()
  }
  // The bundled OpenPets app replaces the native pet window in packaged
  // builds; the native window stays the development and fallback pet.
  const openpets = openpetsExecutable(process.resourcesPath)
  const ensurePet = async (): Promise<DesktopPetController> => {
    if (pet !== undefined) return pet
    petCreation ??= createDesktopPet({
      enabled: preferences.pet.enabled,
      position: preferences.pet.position,
      workAreas,
      onEnabledChange: (enabled) => {
        preferences = { ...preferences, pet: { ...preferences.pet, enabled } }
        persistPreferences()
        refreshShellSafely()
      },
      onPositionChange: (position) => {
        preferences = { ...preferences, pet: { ...preferences.pet, position } }
        persistPreferences()
      },
      onActivate: () => {
        if (window.isMinimized()) window.restore()
        window.show()
        window.focus()
      },
    })
    pet = await petCreation
    return pet
  }
  const togglePet = async (): Promise<void> => {
    if (openpets !== undefined) {
      launchOpenpets(openpets)
      return
    }
    const companion = await ensurePet()
    companion.toggle()
  }
  const runDesktopAction = (target: string): boolean => {
    const action = parseDesktopAction(target)
    if (action === undefined) return false
    if (action.type === 'window') {
      if (action.operation === 'minimize') window.minimize()
      if (action.operation === 'maximize') {
        if (window.isMaximized()) window.unmaximize()
        else window.maximize()
      }
      if (action.operation === 'close') window.close()
      return true
    }
    void togglePet().catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error))
    })
    return true
  }
  window.on('maximize', refreshShellSafely)
  window.on('unmaximize', refreshShellSafely)

  const handleNavigation = (event: Event, target: string): void => {
    if (runDesktopAction(target)) {
      event.preventDefault()
      return
    }
    if (target === DESKTOP_RETRY_URL && retryAction !== undefined) {
      event.preventDefault()
      const retry = retryAction
      retryAction = undefined
      retry()
      return
    }
    const decision = allowedOrigin === undefined ? 'deny' : decideDesktopNavigation(allowedOrigin, target)
    if (decision === 'allow') return
    event.preventDefault()
    if (decision === 'external') openExternal(target)
  }
  window.webContents.on('will-navigate', handleNavigation)
  window.webContents.on('will-redirect', handleNavigation)
  window.webContents.on('render-process-gone', (_event, detail) => {
    onRendererFailure('The desktop renderer stopped unexpectedly (' + detail.reason + ').')
  })
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (runDesktopAction(url)) return { action: 'deny' }
    if (allowedOrigin !== undefined && decideDesktopNavigation(allowedOrigin, url) === 'external') openExternal(url)
    return { action: 'deny' }
  })
  window.once('close', () => {
    pet?.destroy()
    try {
      saveDesktopWindowState(statePath, { bounds: window.getNormalBounds(), maximized: window.isMaximized() })
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error))
    }
  })

  const showHost = async (ready: ReadyEvent): Promise<void> => {
    retryAction = undefined
    allowedOrigin = new URL(ready.origin).origin
    await session.cookies.set({
      url: ready.origin,
      name: ready.cookie.name,
      value: ready.cookie.value,
      httpOnly: true,
      sameSite: 'strict',
      path: '/',
    })
    await window.loadURL(ready.origin)
    if (restored?.maximized === true && !window.isMaximized()) window.maximize()
    await installShell()
    window.show()
  }

  const showFailure = async (message: string, retry: () => void): Promise<void> => {
    allowedOrigin = undefined
    retryAction = retry
    await window.loadURL(desktopFailureDocument(message))
    await installShell()
    window.show()
  }

  await window.loadURL(desktopStartingDocument())
  if (restored?.maximized === true) window.maximize()
  await installShell()
  if (preferences.pet.enabled) {
    if (openpets !== undefined) launchOpenpets(openpets)
    else await ensurePet()
  }
  window.show()
  return { window, showHost, showFailure }
}
