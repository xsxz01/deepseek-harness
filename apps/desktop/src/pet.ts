/** Transparent desktop companion window owned by the main desktop shell. */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { app, BrowserWindow, type Point, type Rectangle } from 'electron'

/** Fixed companion surface dimensions. */
export const DESKTOP_PET_SIZE = { width: 220, height: 200 } as const

/** Live companion window operations. */
export interface DesktopPetController {
  window: BrowserWindow
  enabled: boolean
  toggle: () => void
  destroy: () => void
}

/**
 * Clamp a saved pet position to a current display or choose the primary bottom-right corner.
 * @param position - previously saved top-left point.
 * @param workAreas - current display work areas, with the primary display first.
 * @returns a visible top-left point.
 */
export function restoreDesktopPetPosition(position: Point | undefined, workAreas: readonly Rectangle[]): Point {
  const primary = workAreas[0] ?? { x: 0, y: 0, width: 1280, height: 720 }
  const center = position === undefined
    ? undefined
    : { x: position.x + DESKTOP_PET_SIZE.width / 2, y: position.y + DESKTOP_PET_SIZE.height / 2 }
  const target = center === undefined
    ? primary
    : workAreas.find(area => center.x >= area.x
      && center.x <= area.x + area.width
      && center.y >= area.y
      && center.y <= area.y + area.height) ?? primary
  const fallback = { x: target.x + target.width - DESKTOP_PET_SIZE.width - 20, y: target.y + target.height - DESKTOP_PET_SIZE.height - 20 }
  if (position === undefined) return fallback
  return {
    x: Math.min(Math.max(position.x, target.x), target.x + target.width - DESKTOP_PET_SIZE.width),
    y: Math.min(Math.max(position.y, target.y), target.y + target.height - DESKTOP_PET_SIZE.height),
  }
}

function petDocument(icon: string): string {
  const iconUrl = 'data:image/svg+xml;base64,' + Buffer.from(icon).toString('base64')
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>DeepSeek Companion</title>
<style>
* { box-sizing: border-box; }
html, body { width: 100%; height: 100%; margin: 0; overflow: hidden; background: transparent; font-family: 'Segoe UI', 'Microsoft YaHei UI', sans-serif; user-select: none; }
.stage { -webkit-app-region: drag; position: relative; width: 100%; height: 100%; padding: 42px 20px 12px; }
.bubble { position: absolute; top: 4px; left: 12px; right: 30px; min-height: 38px; padding: 9px 12px; color: #20211f; background: rgba(255, 255, 253, 0.96); border: 1px solid rgba(24, 31, 27, 0.12); border-radius: 6px; box-shadow: 0 8px 24px rgba(18, 25, 21, 0.14); font-size: 12px; line-height: 18px; opacity: 0; transform: translateY(5px); transition: opacity 150ms ease, transform 150ms ease; }
.stage:hover .bubble { opacity: 1; transform: translateY(0); }
.close { -webkit-app-region: no-drag; position: absolute; top: 5px; right: 5px; display: grid; place-items: center; width: 25px; height: 25px; color: #4c504d; background: rgba(255, 255, 253, 0.9); border: 1px solid rgba(24, 31, 27, 0.1); border-radius: 50%; font-family: 'Segoe Fluent Icons', 'Segoe MDL2 Assets'; font-size: 9px; text-decoration: none; }
.close:hover { color: #fff; background: #c42b1c; }
.pet-link { -webkit-app-region: no-drag; display: block; color: inherit; text-decoration: none; }
.pet { position: relative; display: grid; place-items: center; width: 126px; height: 116px; margin: 2px auto 0; background: #f5f7f4; border: 1px solid rgba(31, 50, 39, 0.12); border-radius: 48% 48% 42% 42%; box-shadow: 0 14px 34px rgba(20, 34, 26, 0.18); }
.pet::after { content: ''; position: absolute; bottom: 15px; width: 66px; height: 5px; background: rgba(28, 43, 34, 0.12); border-radius: 50%; }
.pet img { position: relative; z-index: 1; width: 76px; height: 76px; object-fit: contain; transform-origin: 50% 80%; animation: breathe 2.8s ease-in-out infinite; }
.status { position: absolute; right: 34px; bottom: 26px; z-index: 2; width: 11px; height: 11px; background: #3cab68; border: 2px solid #f5f7f4; border-radius: 50%; animation: pulse 2s ease-in-out infinite; }
@keyframes breathe { 0%, 100% { transform: translateY(1px) rotate(-1deg); } 50% { transform: translateY(-5px) rotate(1deg); } }
@keyframes pulse { 0%, 100% { opacity: 0.65; transform: scale(0.9); } 50% { opacity: 1; transform: scale(1.08); } }
@media (prefers-reduced-motion: reduce) { .pet img, .status { animation: none; } .bubble { transition: none; } }
</style>
</head>
<body>
  <main class="stage" aria-label="DeepSeek 桌面伙伴">
    <div class="bubble">一起把这件事做完。</div>
    <a class="close" target="_blank" href="dsh-desktop:pet/hide" aria-label="隐藏桌面宠物" title="隐藏">&#xE8BB;</a>
    <a class="pet-link" target="_blank" href="dsh-desktop:pet/show-main" aria-label="打开 DeepSeek Harness" title="打开 DeepSeek Harness"><span class="pet"><img src="${iconUrl}" alt="DeepSeek"><span class="status"></span></span></a>
  </main>
</body>
</html>`
}

/**
 * Create the hidden companion and restore its position.
 * @param options - initial visibility, position, display work areas, and persistence callbacks.
 * @returns companion window operations owned by the desktop shell.
 */
export async function createDesktopPet(options: {
  enabled: boolean
  position: Point | undefined
  workAreas: readonly Rectangle[]
  onEnabledChange: (enabled: boolean) => void
  onPositionChange: (position: Point) => void
  onActivate: () => void
}): Promise<DesktopPetController> {
  const position = restoreDesktopPetPosition(options.position, options.workAreas)
  const window = new BrowserWindow({
    x: position.x,
    y: position.y,
    width: DESKTOP_PET_SIZE.width,
    height: DESKTOP_PET_SIZE.height,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  let enabled = options.enabled
  let destroying = false
  const persistPosition = (): void => {
    const [x, y] = window.getPosition() as [number, number]
    options.onPositionChange({ x, y })
  }
  const setEnabled = (next: boolean): void => {
    enabled = next
    options.onEnabledChange(enabled)
    if (enabled) {
      window.showInactive()
    } else {
      persistPosition()
      window.hide()
    }
  }
  window.on('close', (event) => {
    if (destroying) return
    event.preventDefault()
    setEnabled(false)
  })
  window.webContents.on('will-navigate', (event, target) => {
    event.preventDefault()
    if (target === 'dsh-desktop:pet/hide') setEnabled(false)
  })
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url === 'dsh-desktop:pet/hide') setEnabled(false)
    if (url === 'dsh-desktop:pet/show-main') options.onActivate()
    return { action: 'deny' }
  })
  const iconPath = app.isPackaged
    ? join(process.resourcesPath, 'desktop', 'favicon.svg')
    : join(import.meta.dirname, '..', '..', 'web', 'public', 'favicon.svg')
  const icon = readFileSync(iconPath, 'utf8')
  await window.loadURL('data:text/html;base64,' + Buffer.from(petDocument(icon)).toString('base64'))
  if (enabled) window.showInactive()
  return {
    window,
    get enabled() { return enabled },
    toggle: () => { setEnabled(!enabled) },
    destroy: () => {
      if (window.isDestroyed()) return
      persistPosition()
      destroying = true
      window.destroy()
    },
  }
}
