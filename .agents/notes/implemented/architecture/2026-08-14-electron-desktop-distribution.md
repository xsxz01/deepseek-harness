# Agent Note: Electron desktop distribution with a supervised Harness Host

Status: implemented

English | [中文](2026-08-14-electron-desktop-distribution.zh.md)

## Problem

DeepSeek Harness needs an installable desktop application that preserves the existing React/Vite client, Cordis plugin composition, HTTP/WebSocket protocol, filesystem access, subprocess and terminal behavior, durable Harness home, and CLI interoperability without requiring a system Node.js or pnpm installation.

The web profile is not a static renderer. It loads packages and user plugins dynamically, injects `window.__DSH_BOOT__`, owns HTTP and WebSocket connections, starts process trees through `node-pty`, and loads native dependencies such as `sharp` and `koffi`. Replacing those mechanisms with a second desktop transport or backend would duplicate production behavior and split verification authority.

The [GUI layering and RPC protocol](../../archived/architecture/2026-07-19-gui-layering-and-rpc-protocol.md) originally reserved an Electron IPC carrier. The desktop product needs a concrete carrier decision without changing the Host/Client split, RPC messages, browser carrier, or ordinary `dsh web` behavior.

## Decision

`apps/desktop` is an Electron main-process application with no second renderer. It supervises the existing Web profile in a separate standard Node.js process and loads that Host's authenticated loopback origin in a sandboxed `BrowserWindow`. The first supported artifact is Windows x64.

Electron owns the single-instance lock, window state, navigation policy, Host lifecycle, retry presentation, and application shutdown. It never imports the Harness composition into the Electron process. The Host remains on the repository's standard Node ABI, so Host crashes, native modules, and dynamically installed Node plugins do not share Electron's ABI or lifecycle.

The NSIS installer registers a root-level `dsh.cmd` in the current user's PATH. The wrapper starts the bundled standard Node CLI without starting Electron, so terminal and desktop processes remain independent while using the same default `DSH_HOME`. Uninstall removes its exact PATH entry but does not delete Harness data. The Electron app contains no migration path or private copy for Harness-owned durable formats.

### Process and protocol ownership

`@deepseek-ai/dsh/desktop-host` starts the Web profile on `127.0.0.1` and a dynamic port. Electron forks it through the bundled Node 24 runtime and owns the child immediately, before readiness. A private Node IPC protocol carries `ready`, `fatal`, and `stopping` events; stdout and stderr remain diagnostics and are never parsed for readiness.

A ready event carries the origin, an HttpOnly cookie name/value pair, the Host PID, and the Harness version. The Host retains the token in private process memory; it travels to Electron only through private IPC and enters the renderer process only as an HttpOnly session cookie. The WebServer requires it before index delivery, API routing, static and plugin assets, HMR resources, and WebSocket upgrades. Existing Host and Origin checks continue downstream.

Host startup, graceful shutdown, and forced process-tree termination have independent deadlines. Malformed or duplicate IPC, early exit, unexpected exit, and renderer termination enter a local CSP-restricted failure document. Retry creates a new Host generation, and generation checks prevent stale readiness or termination events from mutating current state. Application shutdown invalidates pending presentation work and waits only for the owned Host, because renderer navigation may never settle while its window is closing.

### Electron security rules

The production window uses `contextIsolation: true`, `nodeIntegration: false`, and `sandbox: true`, with no preload API. Only the current authenticated Harness origin may navigate in the window. Other loopback origins, `file:`, popups, downloads, and permission requests are denied. Non-loopback HTTP(S) links may open in the system browser. Renderer failure never grants script authority to the local retry document.

Window bounds and maximized state are stored atomically under Electron user data, validated as durable JSON, and clamped to current displays. A removed or resized monitor cannot restore an inaccessible window.

### Desktop product shell

The main window is frameless and installs a compact desktop-only titlebar into every authenticated Host document and local lifecycle document. Caption controls use Windows `Segoe Fluent Icons` glyphs with `Segoe MDL2 Assets` fallback. In the Web layout, a ResizeObserver keeps the titlebar's left edge aligned to the existing sidebar as that column collapses or resizes; the sidebar reaches the window top while the center and details columns begin below the titlebar, and the center surface owns the rounded upper-left corner. The titlebar contains no duplicate product brand.

The renderer receives no general Electron bridge. Window and pet controls emit fixed `dsh-desktop:` targets through denied window-open requests; the main process executes only exact actions. The unprivileged theme button dispatches `dsh-desktop:theme-toggle`, and the existing Web ThemeRuntime converts the resolved scheme to an explicit built-in `light` or `dark` preference through its Host-backed settings path. Desktop code defines no palette and persists no color preference. The detachable desktop companion is a separate transparent, sandboxed, always-on-top BrowserWindow with a local CSP document and embedded product asset. Visibility and display-clamped position persist under Electron user data, selecting the companion restores and focuses the main window, and closing the main window destroys the companion before Host shutdown.

### Runtime and packaging closure

`scripts/desktop/stage-runtime.ts` builds production tarballs, installs their dependency closure without workspace links, downloads a checksum-verified Node 24.19.0 Windows x64 runtime, and probes `node-pty`, `sharp`, `koffi`, and `esbuild` with that Node executable. The staged release records the target, Electron, Node and Harness versions, Node checksum, every workspace package, every installed name/version/license pair, and a third-party license index.

Electron Builder places the main bundle in ASAR and copies Node plus the explicit production `node_modules` tree to `resources/harness`. It does not rebuild Host native modules for the Electron ABI. A pinned pnpm patch makes Electron Builder 26.15.3 tolerate the cache API exposed by its declared `@electron/get` dependency. Builder consumes the already installed, checksum-verified Electron distribution rather than downloading a second copy.

The Windows build produces an assisted per-user NSIS installer, a portable zip, an unpacked diagnostic tree, and a blockmap. The installer adds its directory to the user PATH through an idempotent helper and broadcasts the environment change; uninstall removes only the normalized matching entry. The portable zip includes `dsh.cmd` but does not modify PATH. Uninstall retains `DSH_HOME` and Electron user data by default.

### Verification

Focused unit tests pin navigation denial, durable window and companion preference restoration, desktop action parsing, the built-in theme shortcut lifecycle, pet placement, CLI PATH normalization, protocol parsing, immediate Host ownership, startup and shutdown deadlines, generation races, renderer failure, retry documents, and runtime path selection. A real Electron 43 test connects through CDP and verifies the HttpOnly cookie, absent renderer `require`, Windows caption font, duplicate-brand removal, maximize/restore, companion creation and hiding, Host crash/retry, renderer crash/retry, custom titlebar close, and clean process exit.

The packaged acceptance test starts `win-unpacked/DeepSeek Harness.exe`, invokes its root `dsh.cmd`, waits for the bundled Host's loopback UI, checks the custom shell, authenticated HTTP and renderer isolation, observes exactly one standard Node Host child, closes through the titlebar, and verifies both Electron and Host PIDs exit. The staging smoke and packaged smoke run from release resources rather than workspace imports.

## Alternatives considered

**Tauri 2 with a Node sidecar.** Tauri would reduce shell size but would still distribute Node and the complete Harness dependency tree. It would add Rust, system WebView differences, sidecar permissions, and another cross-platform resource model without removing the dominant backend payload.

**Electron IPC fetch with a `file:` renderer.** This would require second implementations for fetch, WebSocket downlink, dynamic plugin assets, `__DSH_BOOT__`, authentication, and relative browser URLs. Reusing the authenticated Web origin keeps one production carrier and preserves existing browser verification.

**Run Harness in the Electron main or utility process.** This would couple Host faults, native modules, and user plugins to Electron's Node ABI and lifecycle. The supervised standard Node process preserves the supported Host environment and gives Electron a process-tree ownership boundary.

**Require system Node.js.** This would make startup depend on PATH, engine version, native module installation, and package-manager state. An installable desktop product must be self-contained.

**Package the workspace `node_modules`.** Workspace links, development dependencies, stale outputs, and host-platform binaries would enter the artifact. Installing production tarballs proves the actual release closure.

**Build all operating systems immediately.** Multiplying native-module, signing, updater, shell, and installer variables before the process model is proven obscures failures. Windows x64 is the only current support claim.

**Native titlebar overlay.** Electron's native overlay preserves platform caption buttons but cannot follow the live Web sidebar width or provide the same local lifecycle presentation. A frameless window joins the existing sidebar to a compact draggable region, while the glyph font preserves Windows caption iconography.

**General preload IPC for desktop controls.** A preload bridge would add a privileged renderer API and an IPC contract for a closed command set. Exact denied window-open targets preserve the no-preload security rule and cannot carry arbitrary methods or payloads.

**Render the companion inside the main page.** An in-page mascot disappears outside the product window and shares Host renderer failure. A separate sandboxed window can remain visible when the main window is minimized and still dies with its owning desktop shell.

## Consequences

Electron plus standard Node increases artifact size, but keeps one client and one Host transport. Every future target still requires its own staged native dependency closure and packaged acceptance run.

PATH registration makes the bundled CLI available from new terminals without a second installation, but installation now mutates one user environment value and must remove only its own normalized entry. Sharing `DSH_HOME` provides immediate CLI interoperability and shares concurrency and durable-format exposure. Existing package-level locking and schema ownership remain authoritative; desktop code must not add a competing migration mechanism.

The custom shell adds one injected presentation layer without granting renderer authority. Enabling the companion adds a second sandboxed renderer and always-on-top window; its lifecycle and persisted position remain owned by the main desktop window.

Forced shutdown can interrupt active model, tool, PTY, or persistence work. The app attempts graceful quiescence first and then enforces bounded process-tree termination; durable recovery remains the owning packages' responsibility.

Production code signing, stable/beta update channels, update credentials, macOS notarization, Linux packaging, and clean-machine release certification are deferred release infrastructure. Unsigned engineering artifacts are not published to production update channels. The process, authentication, ABI, and packaging decisions in this note remain active guidance for that work.