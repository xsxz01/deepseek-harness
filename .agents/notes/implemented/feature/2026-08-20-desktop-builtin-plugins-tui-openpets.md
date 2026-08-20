# Agent Note: Desktop builtin plugins, the dsh tui launcher, and the OpenPets companion

Status: implemented

English | [中文](2026-08-20-desktop-builtin-plugins-tui-openpets.zh.md)

## Problem

The desktop release shipped only the workspace plugin tree: no third-party plugins rode along, the terminal experience required a manual profile + pnpm install dance, and the desktop pet was a fixed native Electron window. The product request asks for four out-of-tree plugins built into the desktop package (dsh-TUI, dsh-web-ui, dsh-agent-teams, dsh-at-file), a first-class terminal entry for dsh-TUI, and the OpenPets companion app as the desktop pet.

## Decision

**Builtin plugins ship as pinned registry dependencies.** `scripts/desktop/stage-runtime.ts` gains a `BUILTIN_PLUGINS` list pinning exact published versions: `@deepseek-harness-tui/dsh-tui`, `@linxin666/dsh-web-ui-all`, `@nanmicoder/dsh-agent-teams`, and `dsh-at-file`. The runtime root manifest merges them ahead of the packed workspace tarballs (packed wins on conflict), the bundled `npm install` resolves them from the registry into `resources/harness/node_modules`, and a post-install patch records them in the installed `@deepseek-ai/dsh` manifest's `dependencies` so the heal's dependency-closure BFS symlinks them under `$DSH_HOME/profiles/node_modules`. `verifyRuntime` fails the stage when any builtin is missing. Installed-but-disabled: web plugins are opt-in rows in a profile's `cordis.patch.yml`; the plugin inventory shows them as installed and the marketplace resolves them without a per-profile install. The runtime manifest also pins `BUILTIN_REACT_OVERRIDES` (`react`/`react-dom` 19.2.0): dsh-tui declares react ^19.2.0 while the web UI plugins bring react ^18, so without the override npm nests react 19 under dsh-tui while the hoisted `usehooks-ts` resolves react 18 — the reconciler and the components disagree on the hook dispatcher and dsh-tui crashes with "Cannot read properties of null (reading 'useRef')". dsh-tui is the only React consumer that renders in the Node runtime, so the override is safe for the whole staged tree.

**`dsh tui` is a native launcher, not the upstream bin.** The upstream dsh-TUI launcher bootstraps itself through `dsh plugin --profile dsh-tui add`, which needs pnpm inside the runtime; the bundled runtime has none. `apps/cli/src/tui.ts` instead heals the profile modules, seeds `$DSH_HOME/profiles/dsh-tui` with the base + TUI bundle layers on first use, proves the bundle resolves (fail loud in a source checkout), then replicates the upstream argument semantics: `--resume`/bare `-c`/`--continue` read the recorded target (falling back from `.dsh-tui/resume.txt` to `.dsh-cc/resume.txt`) and feed both `DSH_TUI_RESUME_SESSION` and `DSH_CC_RESUME_SESSION`; one workspace target becomes `DSH_TUI_WORKSPACE_TARGET`; the rest pass through to `runProfile` under the `dsh-tui` profile with `NODE_ENV ??= 'production'`. `args.ts` routes the `tui` subcommand (pass-through options, parent options rejected).

**OpenPets replaces the pet with a native fallback.** OpenPets is a standalone Electron app, not a dsh plugin, so it cannot ride the plugin pipeline. `stageOpenpets` (env `DSH_OPENPETS_SOURCE`) builds an OpenPets workspace checkout's desktop app and copies the unpacked output to `resources/openpets`; the desktop shell launches `openpets.exe` detached as the pet when present (`apps/desktop/src/openpets.ts`), and keeps the native pet window when the app is absent or unbuildable. Staging never fails the desktop release: a fallback note replaces the app.

## Alternatives considered

- **Bundle the plugins as tarballs or vendored sources.** Registry pins keep licenses and versions reviewable, let npm resolve transitive deps, and match the existing vendor manifest guard instead of adding a second packaging path.
- **Default-enable the web plugins.** dsh-web-ui replaces the default UI surface and agent-teams changes agent composition; opt-in rows keep the shipped defaults stable and honor the opt-ins-out-of-defaults policy.
- **Spawn the upstream dsh-TUI bin.** Its pnpm-based self-bootstrap cannot run in the pnpm-free bundled runtime; a native launcher with identical argument semantics avoids a second package manager and keeps resume/workspace interception in harness-owned code.
- **Make OpenPets a plugin.** Its published package is an Electron app with no dsh bundle entry; the extraResources seam plus the native pet fallback delivers the product surface without forcing a foreign architecture.

## Verification

stage-runtime specs pin the builtin set, the packed-wins merge, and the React override; tui specs pin resume-target reading, both env names, workspace-target interception, passthrough, and one-time profile seeding; openpets specs pin executable resolution and staging skip/copy; args specs pin `tui` routing and parent-option rejection. The full host typecheck and the desktop unit suites pass; the packaged artifact re-runs the staged runtime verification and the packaged acceptance suite.

## Consequences

The desktop runtime is larger (four plugin trees plus transitive deps) and staging needs registry access at pack time. `dsh tui` requires the bundled dsh-tui package — a source checkout fails loud instead of degrading. The OpenPets pet is one-way: the desktop shell launches the app and does not supervise its window lifecycle; the native pet remains the development and fallback surface. All four plugins appear in the plugin inventory as installed but change nothing until a profile opts in.
