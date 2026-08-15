import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { chromium, type Browser, type Page } from 'playwright'
import { afterEach, describe, expect, it } from 'vitest'

interface DesktopTestApplication {
  browser: Browser
  child: ChildProcess
  endpoint: string
  page: Page
}

const temporaryDirectories: string[] = []
const applications: DesktopTestApplication[] = []
const main = fileURLToPath(new URL('../lib/main.js', import.meta.url))
const hostModule = fileURLToPath(new URL('./fixtures/host-restart.mjs', import.meta.url))
const electronPackage = dirname(createRequire(import.meta.url).resolve('electron'))
const electronExecutable = join(electronPackage, 'dist', 'electron.exe')
const electronEnvironment = { ...process.env }
delete electronEnvironment.ELECTRON_RUN_AS_NODE

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'dsh-desktop-electron-'))
  temporaryDirectories.push(directory)
  return directory
}

async function launch(userData: string): Promise<DesktopTestApplication> {
  const child = spawn(electronExecutable, ['--remote-debugging-port=0', main], {
    env: {
      ...electronEnvironment,
      DSH_DESKTOP_NODE: process.execPath,
      DSH_DESKTOP_HOST_MODULE: hostModule,
      DSH_DESKTOP_USER_DATA: userData,
      ELECTRON_DISABLE_SECURITY_WARNINGS: 'true',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
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
      reject(new Error('Electron exited before CDP readiness (code ' + String(code)
        + ', signal ' + String(signal) + '): ' + diagnostics))
    })
  })
  const browser = await chromium.connectOverCDP(endpoint)
  const context = browser.contexts()[0]
  if (context === undefined) throw new Error('Electron exposed no browser context')
  const page = context.pages()[0] ?? await context.waitForEvent('page')
  const application = { browser, child, endpoint, page }
  applications.push(application)
  return application
}

async function hostPid(page: Page): Promise<number> {
  await page.locator('h1[data-host-pid]').waitFor()
  const value = await page.locator('h1[data-host-pid]').getAttribute('data-host-pid')
  if (value === null) throw new Error('desktop fixture omitted Host pid')
  return Number(value)
}

async function waitForProcessExit(pid: number): Promise<void> {
  await expect.poll(() => {
    try {
      process.kill(pid, 0)
      return false
    } catch (error) {
      return (error as NodeJS.ErrnoException).code === 'ESRCH'
    }
  }, { timeout: 15_000 }).toBe(true)
}

function forceStop(application: DesktopTestApplication): void {
  if (application.child.pid === undefined || application.child.exitCode !== null) return
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(application.child.pid), '/t', '/f'], { stdio: 'ignore' })
  } else {
    application.child.kill('SIGKILL')
  }
}

afterEach(async () => {
  for (const application of applications.splice(0)) {
    forceStop(application)
    await application.browser.close().catch(() => {})
  }
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})

describe('Electron desktop shell', () => {
  it('authenticates, recovers Host and renderer failures, and exits cleanly', async () => {
    const application = await launch(temporaryDirectory())
    const context = application.browser.contexts()[0]
    if (context === undefined) throw new Error('Electron browser context disappeared')
    const firstPid = await hostPid(application.page)
    expect(await application.page.evaluate(() => typeof require)).toBe('undefined')
    const cookie = (await context.cookies()).find(item => item.name === 'dsh-desktop-host')
    expect(cookie).toMatchObject({ httpOnly: true, sameSite: 'Strict' })

    const titlebar = application.page.locator('#dsh-desktop-titlebar')
    await titlebar.waitFor()
    expect(await application.page.locator('.dsh-desktop-caption-close').evaluate(element => (
      getComputedStyle(element).fontFamily
    ))).toContain('Segoe Fluent Icons')
    expect(await titlebar.locator('.dsh-desktop-brand').count()).toBe(0)
    const themeEvent = application.page.evaluate(() => new Promise<boolean>((resolve) => {
      window.addEventListener('dsh-desktop:theme-toggle', () => { resolve(true) }, { once: true })
      document.getElementById('dsh-desktop-theme-button')?.click()
    }))
    await expect(themeEvent).resolves.toBe(true)
    expect(await application.page.locator('html').getAttribute('data-dsh-desktop-web-layout')).toBe('false')

    await application.page.locator('.dsh-desktop-maximize').click()
    await expect.poll(() => application.page.locator('html').getAttribute('data-dsh-desktop-maximized')).toBe('true')
    await application.page.locator('.dsh-desktop-maximize').click()
    await expect.poll(() => application.page.locator('html').getAttribute('data-dsh-desktop-maximized')).toBe('false')

    const petPagePromise = context.waitForEvent('page')
    await application.page.locator('a[href="dsh-desktop:pet/toggle"]').click()
    const petPage = await petPagePromise
    await expect.poll(() => petPage.title()).toBe('DeepSeek Companion')
    expect(await petPage.locator('.pet img').getAttribute('src')).toMatch(/^data:image\/svg\+xml;base64,/u)
    await expect.poll(() => application.page.locator('html').getAttribute('data-dsh-desktop-pet')).toBe('true')
    await petPage.getByRole('link', { name: '隐藏桌面宠物' }).click()
    await expect.poll(() => application.page.locator('html').getAttribute('data-dsh-desktop-pet')).toBe('false')

    await application.page.locator('#crash').click()
    await application.page.getByRole('heading', { name: 'Harness Host stopped' }).waitFor()
    await waitForProcessExit(firstPid)
    await application.page.getByRole('link', { name: 'Retry' }).click()
    const secondPid = await hostPid(application.page)
    expect(secondPid).not.toBe(firstPid)
    expect(await application.page.locator('#dsh-desktop-skin-button').count()).toBe(0)

    const session = await context.newCDPSession(application.page)
    await session.send('Page.crash').catch(() => {})
    await waitForProcessExit(secondPid)
    const recoveredBrowser = await chromium.connectOverCDP(application.endpoint)
    application.browser = recoveredBrowser
    const recoveredContext = recoveredBrowser.contexts()[0]
    if (recoveredContext === undefined) throw new Error('recovered Electron exposed no browser context')
    let recoveredPage: Page | undefined
    await expect.poll(async () => {
      for (const candidate of recoveredContext.pages()) {
        if (!candidate.isClosed() && await candidate.getByRole('heading', { name: 'Harness Host stopped' }).isVisible()) {
          recoveredPage = candidate
          return true
        }
      }
      return false
    }).toBe(true)
    if (recoveredPage === undefined) throw new Error('recovered Electron exposed no failure page')
    await recoveredPage.getByRole('link', { name: 'Retry' }).click()
    const thirdPid = await hostPid(recoveredPage)
    expect(thirdPid).not.toBe(secondPid)

    const electronPid = application.child.pid
    if (electronPid === undefined) throw new Error('Electron process has no pid')
    await recoveredPage.locator('.dsh-desktop-caption-close').click()
    await waitForProcessExit(thirdPid)
    await waitForProcessExit(electronPid)
  })
})
