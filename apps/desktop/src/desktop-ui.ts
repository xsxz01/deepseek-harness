/** Desktop-only titlebar presentation and its restricted action URLs. */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/** State rendered into the sandboxed desktop titlebar. */
export interface DesktopShellState {
  petEnabled: boolean
  maximized: boolean
}

/** One action accepted from the sandboxed desktop document. */
export type DesktopAction =
  | { type: 'window'; operation: 'minimize' | 'maximize' | 'close' }
  | { type: 'pet'; operation: 'toggle' }

const WINDOW_ACTIONS = new Map<string, DesktopAction>([
  ['dsh-desktop:window/minimize', { type: 'window', operation: 'minimize' }],
  ['dsh-desktop:window/maximize', { type: 'window', operation: 'maximize' }],
  ['dsh-desktop:window/close', { type: 'window', operation: 'close' }],
  ['dsh-desktop:pet/toggle', { type: 'pet', operation: 'toggle' }],
])

/**
 * Parse one renderer navigation as a restricted desktop action.
 * @param target - absolute navigation target received from Electron.
 * @returns the accepted action or undefined for every other target.
 */
export function parseDesktopAction(target: string): DesktopAction | undefined {
  return WINDOW_ACTIONS.get(target)
}

/**
 * Read the packaged desktop shell stylesheet.
 * @returns the complete CSS installed into each desktop document.
 */
export function readDesktopShellStyle(): string {
  return readFileSync(join(import.meta.dirname, '..', 'assets', 'desktop-shell.css'), 'utf8')
}

const DESKTOP_SHELL_MARKUP = String.raw`
<header id="dsh-desktop-titlebar" aria-label="桌面窗口标题栏">
  <div class="dsh-desktop-drag-region"></div>
  <nav class="dsh-desktop-tools" aria-label="桌面工具">
    <button id="dsh-desktop-theme-button" class="dsh-desktop-tool" type="button" title="切换到深色模式" aria-label="切换到深色模式"><span class="dsh-desktop-glyph dsh-desktop-theme-light">&#xE706;</span><span class="dsh-desktop-glyph dsh-desktop-theme-dark">&#xE708;</span></button>
    <a class="dsh-desktop-tool" target="_blank" href="dsh-desktop:pet/toggle" title="显示或隐藏桌面宠物" aria-label="显示或隐藏桌面宠物"><img src="/favicon.svg" alt=""></a>
  </nav>
  <nav class="dsh-desktop-caption" aria-label="窗口控制">
    <a target="_blank" href="dsh-desktop:window/minimize" title="最小化" aria-label="最小化">&#xE921;</a>
    <a class="dsh-desktop-maximize" target="_blank" href="dsh-desktop:window/maximize" title="最大化或还原" aria-label="最大化或还原"><span class="dsh-desktop-maximize-glyph">&#xE922;</span><span class="dsh-desktop-restore-glyph">&#xE923;</span></a>
    <a class="dsh-desktop-caption-close" target="_blank" href="dsh-desktop:window/close" title="关闭" aria-label="关闭">&#xE8BB;</a>
  </nav>
</header>
`

/**
 * Build an isolated script that installs or refreshes the desktop titlebar.
 * @param state - current main-process-owned desktop shell state.
 * @returns JavaScript source for Electron's sandboxed renderer.
 */
export function desktopShellScript(state: DesktopShellState): string {
  const serializedState = JSON.stringify(state)
  const serializedMarkup = JSON.stringify(DESKTOP_SHELL_MARKUP)
  return `(() => {
    const state = ${serializedState};
    const root = document.documentElement;
    root.dataset.dshDesktopMaximized = String(state.maximized);
    root.dataset.dshDesktopPet = String(state.petEnabled);
    let titlebar = document.getElementById('dsh-desktop-titlebar');
    if (titlebar === null) {
      document.body.insertAdjacentHTML('afterbegin', ${serializedMarkup});
      titlebar = document.getElementById('dsh-desktop-titlebar');
      document.getElementById('dsh-desktop-theme-button')?.addEventListener('click', () => {
        window.dispatchEvent(new Event('dsh-desktop:theme-toggle'));
      });
    }
    window.__dshDesktopShellCleanup?.();
    let sidebar;
    const resize = new ResizeObserver(() => { syncLayout(); });
    const layoutMutations = new MutationObserver(() => { syncLayout(); });
    const syncTheme = () => {
      const dark = document.body.hasAttribute('data-ds-dark-theme');
      root.dataset.dshDesktopDark = String(dark);
      const button = document.getElementById('dsh-desktop-theme-button');
      const label = dark ? '切换到浅色模式' : '切换到深色模式';
      button?.setAttribute('title', label);
      button?.setAttribute('aria-label', label);
    };
    const syncLayout = () => {
      const rootElement = document.getElementById('root');
      const slot = rootElement?.querySelector(':scope > [data-slot="root"]');
      const frame = slot?.firstElementChild;
      const nextSidebar = frame?.firstElementChild;
      const webLayout = frame !== null && frame !== undefined
        && nextSidebar !== null && nextSidebar !== undefined
        && nextSidebar.querySelector('[data-slot="sidebar"]') !== null;
      root.dataset.dshDesktopWebLayout = String(webLayout);
      root.style.setProperty('--dsh-desktop-sidebar-width', webLayout ? nextSidebar.getBoundingClientRect().width + 'px' : '0px');
      if (nextSidebar !== sidebar) {
        resize.disconnect();
        sidebar = nextSidebar;
        if (sidebar !== null && sidebar !== undefined) resize.observe(sidebar);
      }
      layoutMutations.disconnect();
      if (slot !== null && slot !== undefined) layoutMutations.observe(slot, { childList: true });
      else if (rootElement !== null && rootElement !== undefined) layoutMutations.observe(rootElement, { childList: true });
      if (frame !== null && frame !== undefined) layoutMutations.observe(frame, { childList: true });
    };
    const themeMutations = new MutationObserver(() => { syncTheme(); });
    themeMutations.observe(document.body, { attributes: true, attributeFilter: ['data-ds-dark-theme'] });
    syncTheme();
    syncLayout();
    window.__dshDesktopShellCleanup = () => { themeMutations.disconnect(); layoutMutations.disconnect(); resize.disconnect(); };
    return {
      titlebar: titlebar !== null,
      maximized: root.dataset.dshDesktopMaximized,
      petEnabled: root.dataset.dshDesktopPet,
      dark: root.dataset.dshDesktopDark,
      webLayout: root.dataset.dshDesktopWebLayout,
    };
  })()`
}
