import { describe, expect, it } from 'vitest'
import { desktopShellScript, parseDesktopAction, readDesktopShellStyle } from '../src/desktop-ui.ts'

describe('desktop shell actions', () => {
  it('accepts only fixed window and pet actions', () => {
    expect(parseDesktopAction('dsh-desktop:window/minimize')).toEqual({ type: 'window', operation: 'minimize' })
    expect(parseDesktopAction('dsh-desktop:window/maximize')).toEqual({ type: 'window', operation: 'maximize' })
    expect(parseDesktopAction('dsh-desktop:window/close')).toEqual({ type: 'window', operation: 'close' })
    expect(parseDesktopAction('dsh-desktop:pet/toggle')).toEqual({ type: 'pet', operation: 'toggle' })
    expect(parseDesktopAction('dsh-desktop:skin/forest')).toBeUndefined()
    expect(parseDesktopAction('dsh-desktop:window/devtools')).toBeUndefined()
    expect(parseDesktopAction('https://example.com/dsh-desktop:window/close')).toBeUndefined()
  })

  it('renders theme integration and main-process-owned shell state without duplicate branding', () => {
    const script = desktopShellScript({ petEnabled: true, maximized: false })
    expect(script).toContain('"petEnabled":true')
    expect(script).toContain('dsh-desktop-titlebar')
    expect(script).toContain('dsh-desktop:theme-toggle')
    expect(script).toContain('--dsh-desktop-sidebar-width')
    expect(script).toContain('dsh-desktop:window/close')
    expect(script).not.toContain('DeepSeek Harness</strong>')
    expect(script).not.toContain('dsh-desktop:skin/')
  })

  it('uses Windows caption fonts and joins the native sidebar to rounded content', () => {
    const style = readDesktopShellStyle()
    expect(style).toContain("font-family: 'Segoe Fluent Icons', 'Segoe MDL2 Assets'")
    expect(style).toContain("data-dsh-desktop-web-layout='true'")
    expect(style).toContain("data-dsh-desktop-web-layout='false'] #dsh-desktop-theme-button")
    expect(style).toContain('background: var(--dsw-specific-sidebar-fill)')
    expect(style).toContain('border-left: 1px solid var(--dsw-alias-border-l1)')
    expect(style).toContain('border-radius: 10px 0 0 0')
    expect(style).toContain('border-right: 0 !important')
    expect(style).not.toContain('--dsw-alias-bg-base:')
    expect(style).not.toContain("data-dsh-desktop-skin='")
  })
})
