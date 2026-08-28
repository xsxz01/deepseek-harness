import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium, type Browser, type Page } from 'playwright'
import { afterEach, describe, expect, it } from 'vitest'

interface PackagedApplication {
  browser: Browser
  child: ChildProcess
  page: Page
  userData: string
}

const output = process.env.DSH_DESKTOP_PACKAGED_OUTPUT ?? join(import.meta.dirname, '..', 'dist')
const unpacked = join(output, 'win-unpacked')
const executable = join(unpacked, 'DeepSeek Harness.exe')
const cli = join(unpacked, 'dsh.cmd')
const packagedVersion = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'package.json'), 'utf8')).version as string
const electronEnvironment = { ...process.env }
delete electronEnvironment.ELECTRON_RUN_AS_NODE
let application: PackagedApplication | undefined

async function waitForProcessExit(pid: number): Promise<void> {
  await expect.poll(() => {
    try {
      process.kill(pid, 0)
      return false
    } catch (error) {
      return (error as NodeJS.ErrnoException).code === 'ESRCH'
    }
  }, { timeout: 20_000 }).toBe(true)
}

function childNodePids(parentPid: number): number[] {
  const command = 'Get-CimInstance Win32_Process -Filter "ParentProcessId = ' + String(parentPid) + '"'
    + " | Where-Object { $_.Name -eq 'node.exe' } | Select-Object -ExpandProperty ProcessId"
  const result = spawnSync('pwsh', ['-NoProfile', '-Command', command], { encoding: 'utf8' })
  if (result.status !== 0) throw new Error('failed to inspect packaged child processes: ' + result.stderr)
  return result.stdout.split(/\s+/u).filter(Boolean).map(Number)
}

async function launch(): Promise<PackagedApplication> {
  const userData = mkdtempSync(join(tmpdir(), 'dsh-desktop-packaged-'))
  // Isolate the harness home so the packaged host never collides with a
  // running dsh instance (e.g. the task-board ledger's single-owner lock).
  electronEnvironment.DSH_HOME = join(userData, 'dsh-home')
  const child = spawn(executable, ['--remote-debugging-port=0', '--user-data-dir=' + userData], {
    env: electronEnvironment,
    stdio: ['ignore', 'ignore', 'pipe'],
    windowsHide: true,
  })
  let diagnostics = ''
  const endpoint = await new Promise<string>((resolve, reject) => {
    child.stderr?.on('data', (chunk: Buffer) => {
      diagnostics += chunk.toString()
      const match = /DevTools listening on (ws:\/\/\S+)/u.exec(diagnostics)
      if (match?.[1] !== undefined) resolve(match[1])
    })
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      reject(new Error('packaged desktop exited before CDP readiness (code ' + String(code)
        + ', signal ' + String(signal) + '): ' + diagnostics))
    })
  })
  const browser = await chromium.connectOverCDP(endpoint)
  const context = browser.contexts()[0]
  if (context === undefined) throw new Error('packaged desktop exposed no browser context')
  const page = context.pages()[0] ?? await context.waitForEvent('page')
  return { browser, child, page, userData }
}

function forceStop(current: PackagedApplication): void {
  if (current.child.pid === undefined || current.child.exitCode !== null) return
  spawnSync('taskkill', ['/pid', String(current.child.pid), '/t', '/f'], { stdio: 'ignore' })
}

afterEach(async () => {
  if (application === undefined) return
  forceStop(application)
  await application.browser.close().catch(() => {})
  rmSync(application.userData, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  application = undefined
})

describe('packaged Electron desktop', () => {
  it('runs the bundled Host and installed CLI without process residue', async () => {
    const cliResult = spawnSync('"' + cli + '" --version', {
      encoding: 'utf8',
      windowsHide: true,
      shell: true,
    })
    expect(cliResult.status, cliResult.stderr).toBe(0)
    expect(cliResult.stdout.trim()).toBe(packagedVersion)

    application = await launch()
    await expect.poll(() => application?.page.url(), { timeout: 60_000 })
      .toMatch(/^http:\/\/127\.0\.0\.1:\d+\//u)
    await application.page.locator('#root').waitFor()
    expect(await application.page.evaluate(() => typeof require)).toBe('undefined')
    const context = application.browser.contexts()[0]
    if (context === undefined) throw new Error('packaged browser context disappeared')
    const cookie = (await context.cookies()).find(item => item.name.startsWith('dsh-auth-'))
    expect(cookie).toMatchObject({ httpOnly: true, sameSite: 'Strict' })
    expect(await application.page.evaluate(async () => (await fetch('/')).status)).toBe(200)
    const titlebar = application.page.locator('#dsh-desktop-titlebar')
    await titlebar.waitFor()
    expect(await titlebar.locator('.dsh-desktop-brand').count()).toBe(0)
    await expect.poll(() => application?.page.locator('html').getAttribute('data-dsh-desktop-web-layout')).toBe('true')
    const frame = application.page.locator('#root > [data-slot="root"] > :first-child')
    const sidebar = frame.locator(':scope > :first-child')
    const center = frame.locator(':scope > :nth-child(2)')
    await expect.poll(async () => {
      const titlebarBox = await titlebar.boundingBox()
      const sidebarBox = await sidebar.boundingBox()
      if (titlebarBox === null || sidebarBox === null) return Number.POSITIVE_INFINITY
      return Math.abs(titlebarBox.x - sidebarBox.width)
    }).toBeLessThan(0.5)
    expect((await center.boundingBox())?.y).toBe(40)
    const surfaceStyles = await application.page.evaluate(() => {
      const frameElement = document.querySelector('#root > [data-slot="root"] > :first-child')
      if (frameElement === null) throw new Error('packaged Web frame disappeared')
      const sidebarStyle = getComputedStyle(frameElement.children[0])
      const centerStyle = getComputedStyle(frameElement.children[1])
      const titlebarStyle = getComputedStyle(document.getElementById('dsh-desktop-titlebar') as HTMLElement)
      return {
        centerRadius: centerStyle.borderTopLeftRadius,
        centerLeft: centerStyle.borderLeftStyle,
        centerTop: centerStyle.borderTopStyle,
        sidebarRight: sidebarStyle.borderRightStyle,
        frameBackground: getComputedStyle(frameElement).backgroundColor,
        sidebarBackground: sidebarStyle.backgroundColor,
        titlebarBackground: titlebarStyle.backgroundColor,
      }
    })
    expect(surfaceStyles).toMatchObject({
      centerRadius: '10px',
      centerLeft: 'solid',
      centerTop: 'solid',
      sidebarRight: 'none',
    })
    expect(surfaceStyles.frameBackground).toBe(surfaceStyles.sidebarBackground)
    expect(surfaceStyles.titlebarBackground).toBe(surfaceStyles.sidebarBackground)

    const wasDark = await application.page.locator('body').getAttribute('data-ds-dark-theme') !== null
    await application.page.locator('#dsh-desktop-theme-button').click()
    await expect.poll(async () => await application?.page.locator('body').getAttribute('data-ds-dark-theme') !== null).toBe(!wasDark)
    await expect.poll(async () => await application?.page.evaluate(() => {
      const frameElement = document.querySelector('#root > [data-slot="root"] > :first-child')
      if (frameElement === null) throw new Error('packaged Web frame disappeared after theme toggle')
      const frame = getComputedStyle(frameElement).backgroundColor
      const sidebar = getComputedStyle(frameElement.children[0]).backgroundColor
      const titlebar = getComputedStyle(document.getElementById('dsh-desktop-titlebar') as HTMLElement).backgroundColor
      return frame === sidebar && titlebar === sidebar
    })).toBe(true)
    await application.page.getByRole('button', { name: '收起侧边栏' }).click()
    await expect.poll(async () => {
      const titlebarBox = await titlebar.boundingBox()
      const sidebarBox = await sidebar.boundingBox()
      if (titlebarBox === null || sidebarBox === null) return Number.POSITIVE_INFINITY
      return Math.abs(titlebarBox.x - sidebarBox.width)
    }).toBeLessThan(0.5)

    const electronPid = application.child.pid
    if (electronPid === undefined) throw new Error('packaged Electron process has no pid')
    const hostPids = childNodePids(electronPid)
    expect(hostPids).toHaveLength(1)
    await application.page.locator('.dsh-desktop-caption-close').evaluate((element: HTMLElement) => {
      setTimeout(() => { element.click() }, 0)
    })
    await waitForProcessExit(electronPid)
    for (const hostPid of hostPids) await waitForProcessExit(hostPid)
  })
})
