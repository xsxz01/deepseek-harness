# Web app stops opening the default browser unless asked

English | [中文](2026-08-20-web-default-no-browser-open.zh.md)

## Decision

The `dsh web` app now serves and prints its URL without opening the
default browser. The handoff requires an explicit `--open` flag; the
`--no-open` flag is removed and the config default flips to `false`.
The desktop Host already passed `--no-open` and now relies on the
shipped default instead of naming the flag.

## Context

The desktop product experience (and the marketplace-era feedback that
started this work) treated an automatic browser window at a random
loopback port as noise on startup: the desktop Electron shell loads the
authenticated Host URL itself, and launching the Web GUI from a
shortcut or command line should not hijack the user's browser. The web
app's handoff previously defaulted on with `--no-open` as the opt-out,
which is the wrong default for a harness whose server surface is
commonly launched by scripts, SSH clients, and editors.

## Alternatives

- Keep `--no-open` and only teach the desktop entry point to pass it.
  This leaves every other `dsh web` caller with the noisy default and
  does not fix the root default.
- Make commander report the option source to distinguish "not named"
  from `--no-open`. The flag inversion is simpler and matches the
  pre-release stance of renaming freely when every reference moves
  together.

## Consequences

- `dsh web` and `dsh --profile web` print the URL line and never open a
  browser unless `--open` is named; an SSH launch still suppresses the
  handoff and prints the URL.
- The web-app config default is `openBrowser: false`; `web-startup`
  normalizes the undefined commander value to `false`.
- Callers, tests, docs (CLI reference, web-app README, root README),
  the publish probe, and the browser-open snapshot all follow the
  reversed default. The keyless translation-prompt snapshot re-records
  the README text.
- The desktop Host's `--no-open` argument is gone; its behavior is
  unchanged (Electron loads the authenticated URL, never the browser).
