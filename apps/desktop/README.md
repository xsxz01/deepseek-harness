# @deepseek-ai/dsh-desktop

English | [中文](README.zh.md)

Private Electron product application for DeepSeek Harness. The Electron main process owns the single application instance, a sandboxed BrowserWindow, navigation policy, and bounded shutdown. It forks the built `@deepseek-ai/dsh/desktop-host` entry with a standard Node executable; the child boots the ordinary Web profile on an authenticated dynamic loopback origin and retains the existing HTTP/WebSocket, plugin, session, terminal, filesystem, and subprocess behavior.

The renderer has `contextIsolation` and Chromium sandboxing enabled and has no Node integration or preload API. Before navigation, Electron installs the per-process Host cookie received over private Node IPC. The Host WebServer checks that cookie before every HTTP route, static fallback, plugin/HMR resource, and WebSocket upgrade; API Host/Origin checks still run downstream. Startup errors, Host exits, protocol violations, and renderer termination enter a local retry state that owns no Node authority and starts a fresh Host generation.

The frameless product window installs a compact custom titlebar into each hosted or local-state document. Windows caption controls use `Segoe Fluent Icons` with `Segoe MDL2 Assets` fallback. In the hosted Web layout, the existing collapsible sidebar reaches the top window edge, the titlebar begins at the sidebar's live width, and the content surface starts below it with a rounded upper-left corner. The titlebar's light/dark shortcut uses the Web profile's built-in theme service and semantic tokens; the desktop package owns no color skin. A detachable transparent desktop companion persists its visibility and position under Electron user data, and selecting it restores and focuses the main window. Desktop actions cross the sandbox only as fixed `dsh-desktop:` window-open requests that the main process executes from an exact allowlist and denies as browser windows.

The NSIS installer places `dsh.cmd` beside the desktop executable and registers that directory in the current user's `PATH`. New terminals can invoke `dsh`; the wrapper launches the same bundled standard Node and production CLI tree without starting Electron. Desktop and terminal processes remain independent and share the normal `DSH_HOME`. Uninstall removes only its exact PATH entry and retains Harness data.

## Development

Build Host artifacts and the Web frontend from the repository root, then start the desktop workspace:

```sh
pnpm run build
pnpm --filter @deepseek-ai/dsh-desktop start
```

Development resolves `@deepseek-ai/dsh/desktop-host` from the built workspace package and uses `DSH_DESKTOP_NODE`, `npm_node_execpath`, or `node` in that order. `DSH_DESKTOP_HOST_MODULE` substitutes a Host entry and `DSH_DESKTOP_USER_DATA` isolates Electron state for acceptance tests. Production ignores those development substitutions and resolves the standard Node executable and installed Harness tree from `resources/harness`; missing resources fail before Host startup.

`pnpm run desktop:test:e2e` runs the serial source-mode Electron product and lifecycle acceptance test after a build. `pnpm run desktop:package:win` rebuilds the repository, stages the verified runtime, runs Electron Builder, and writes `SHA256SUMS.txt`. `pnpm run desktop:test:packaged` validates the unpacked artifact, bundled Host, custom shell, and `dsh.cmd` on Windows. The release targets are an assisted NSIS installer and a portable zip; only NSIS installation registers PATH.

## Model Experience

None. The desktop package supervises and presents the existing Web profile; it adds no model-visible message, tool, prompt section, or provider request field.

#### KV Cache effect

None; model requests remain owned by the booted Harness profile.

## Known Limitations and Deferred Work

- The unpacked Windows artifact, bundled Host, custom shell, and CLI wrapper pass packaged acceptance on the build machine. Clean-machine NSIS install, PATH propagation, upgrade, and uninstall certification still requires a disposable Windows runner.
- Windows x64 is the only packaging target. macOS signing/notarization and Linux artifacts require separate native dependency closures and release validation.
- Code signing and stable/beta update channels require release credentials and publishing infrastructure. Unsigned development artifacts do not enter production update channels.
