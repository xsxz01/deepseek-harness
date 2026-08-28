# Agent Note: Desktop window authenticates through the Host token exchange

Status: implemented

English | [中文](2026-08-28-desktop-browser-token-exchange.zh.md)

## Problem

After merging upstream master (dsh-0.1.2-alpha.1), the packaged desktop showed the
"dsh web authentication required" page instead of the Web UI. The merged Web
runtime authenticates the index with the upstream BrowserAuth flow
(packages/client/connection/src/browser-auth.ts): the client loads `/?token=<process launch token>`,
the server answers 303 with a signed `dsh-auth-*` cookie, and the redirect carries it.
The fork's desktop Host still ran the pre-merge flow: it minted its own random token,
registered it as the WebServer launch authentication, and had Electron pre-set the
`dsh-desktop-host` cookie before loading the origin. Two faults made that unusable:
the webserver launch-authentication no longer binds to the merged bundle's root, and
Chromium did not send a cookie installed through `session.cookies.set` before the
first navigation, so the fork cookie never reached the server.

## Decision

The desktop Host adopts the upstream exchange end to end.

- `apps/cli/src/desktop-host-protocol.ts`: the ready event now carries the
  authenticated URL (`url`) instead of the pre-set cookie; the parser validates a
  loopback URL whose only query input is a 43-char `token`.
- `apps/cli/src/desktop-host.ts`: drops `provideWebServerAuthentication` and asks the
  `connection` service for `authenticatedUrl(origin)`.
- `apps/desktop/src/window.ts`: loads `ready.url`; the server's 303 Set-Cookie is the
  only cookie installation path.
- The desktop fixtures and e2e assertions follow the exchange (cookie name prefix
  `dsh-auth-`, SameSite Strict, HttpOnly).
- `desktop:package:win` prepends `tsc -b apps/desktop/tsconfig.json`: the desktop is
  private and absent from tsconfig.host.json, so the official build never refreshed its
  `lib/types`, and tsdown bundled a stale desktop module into `lib/main.js` after any
  `apps/desktop/src` change.

## Consequences

The desktop window performs the same authentication exchange as `dsh web` in a
browser. The fork's `dsh-desktop-host` cookie and its Electron pre-set path are gone;
the WebServer launch-authentication capability remains exported for other callers.
Packaging is now self-contained: touching `apps/desktop/src` no longer silently ships
a stale renderer main in the installer.
