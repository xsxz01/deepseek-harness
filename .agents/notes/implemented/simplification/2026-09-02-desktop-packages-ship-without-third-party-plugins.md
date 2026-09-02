# Agent Note: Desktop packages ship without third-party plugins

Status: implemented

English | [中文](2026-09-02-desktop-packages-ship-without-third-party-plugins.zh.md)

## Problem

The desktop product bundled four out-of-tree plugins — `@deepseek-harness-tui/dsh-tui`, `@linxin666/dsh-web-ui-all`, `@nanmicoder/dsh-agent-teams`, and `dsh-at-file` — as builtin registry dependencies pinned in `BUILTIN_PLUGINS` (`scripts/desktop/stage-runtime.ts`). Bundling third-party code into every release artifact carries a standing obligation — pinned versions, licenses, transitive and peer resolution — that is not justified while the builtin mechanism is still stabilizing, and it ships code the project does not own in every desktop release.

## Decision

Desktop packages ship without third-party plugins. `BUILTIN_PLUGINS` is an empty list by default, while the seams around it stay wired: `runtimeDependencies` merges registry specs into the runtime manifest, `addBuiltinDependencies` records them in the installed CLI manifest for the profile-heal closure, and `verifyRuntime` fails the stage when a listed builtin is missing. A later release re-enables builtins by restoring the pinned entries. The dsh-tui-only React instance pins (`BUILTIN_REACT_OVERRIDES`) and the tui workspace-pin and dedupe helpers were removed with the bundle they served. `PROFILE_TEMPLATES.web` (`packages/boot/app-boot/src/profile.ts`) still lists the out-of-tree bundles after the web-app layer, but `loadProfile` seeds only the template layers the installation can resolve, so a runtime without the plugins stays on the in-box web stack. `dsh tui` boots the dsh-TUI profile once the published `@deepseek-harness-tui/dsh-tui` package is installed and fails loud while it is absent.

## Alternatives considered

- **Keep bundling behind a test-only skip flag.** The previous `DSH_DESKTOP_SKIP_BUILTINS=1` gate emptied the list only for test builds, so production packages still shipped the plugins. Deferring the obligation on every release is exactly what the stabilization wait is for.
- **Remove the builtin seams entirely.** Emptying the list while keeping `runtimeDependencies`/`addBuiltinDependencies`/`verifyRuntime` wired preserves the re-enable path and its stage-time verification; deleting them would force a rewrite when the mechanism stabilizes and would discard the tested seams.

## Consequences

- Desktop artifacts no longer contain third-party npm packages; the packaged tree's licenses and transitive resolution shrink to the workspace and its first-party dependencies.
- The dsh-TUI terminal, web UI pack, dsh-agent-teams, and dsh-at-file arrive through on-demand install (Host-owned plugin marketplace, profile `cordis.patch.yml` rows) instead of pre-installed.
- Re-enabling builtins later is a data change (restore pinned entries in `BUILTIN_PLUGINS`), plus restoring the dsh-tui React handling if the TUI bundle returns.

## Related

- [Desktop builtin plugins and the OpenPets companion](../feature/2026-08-20-desktop-builtin-plugins-tui-openpets.md) records the mechanism this note suspends and keeps the rationale of the surviving seams.
