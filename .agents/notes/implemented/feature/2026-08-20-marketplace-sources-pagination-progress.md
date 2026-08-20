# Agent Note: Marketplace third-party sources, paging, and install progress

Status: implemented

English | [中文](2026-08-20-marketplace-sources-pagination-progress.zh.md)

## Problem

The host-owned plugin marketplace (cherry-picked from 2fb925dfbc) exposed only the dsh.do bundle catalog and the GitHub `dsh-plugin` topic, returned one bounded page per listing, and gave the browser no visibility into an install in progress. The product request adds three third-party catalogs (dshplugin.io, dshmarket.com, dsh.deepseek404.com), paginated browsing, and a visual install progress bar.

## Decision

The `PluginMarketplaceSource` union grows to five: the existing `dsh` and `github` providers keep their API-backed listings, while `dshplugin`, `dshmarket`, and `dsh404` scrape public catalog pages. The dshplugin.io adapter reads the site sitemap (plugin slugs, paged client-side over the full list); the dshmarket.com adapter parses the static browse page's owner/repository cards; the dsh.deepseek404.com adapter reads server-side `?page=N` pages with type and description. `PluginMarketplaceListRequest` gains optional `page`/`pageSize`; the snapshot carries the requested `page`, the derived `pages`, and the total; `pageSize` is clamped to the `maxEntries` config cap.

None of the three third-party pages expose version, star, or npm identity, so their entries list with neutral metadata and `installed: false`. Mutation resolves the real identity lazily: dshplugin fetches the plugin's detail page and picks the GitHub repository link that is not the site's own repo; dshmarket and dsh404 use the owner/repository id directly; all three then fetch the repository's HEAD `package.json` from raw.githubusercontent.com to learn the npm package name and require `dsh.bundle.patch`. The existing `github` and `dsh` resolution paths are unchanged.

The gateway publishes a new `progress` Remote. Mutations report stages `resolve` → `install` → `activate` → `done` with a 0-100 percentage and the package-manager output tail; the `install` percentage rises from the pnpm run's elapsed time while a 500 ms poll forwards its diagnostics. Failures report the `failed` stage before the mutation rejects, and the state resets to `idle` in `finally`.

The Settings tab renders five source buttons, prev/next paging controls over the Host-derived page count, and — while a mutation runs — a progress bar polled from `progress()` every 400 ms showing stage, percentage, resolved package name, and output tail. Install and remove buttons stay disabled until the operation settles.

## Alternatives considered

- **Depend on the `dshmarket` npm aggregator package advertised by dshmarket.com.** Its publishing state is unverified and the site's own pages are the stable public contract, so the scraper stays provider-neutral.
- **Derive pnpm progress from tarball counts.** pnpm's progress line is not a stable contract across versions; the deterministic stage range plus the real output tail keeps the bar truthful without parsing internals.
- **Drop the third-party sources when their pages cannot prove npm identity.** The lazy mutation resolution keeps browsing useful and makes install the point where identity is verified, which matches the existing github/dsh pattern of resolving at mutation time.

## Verification

catalog specs stub each source's XML/HTML and pin slug/card parsing, query filtering, paging bounds and page-size caps, and mutation resolution including missing-repository and missing-bundle rejections. Gateway specs pin the published Remote method list including `progress`, pagination passthrough, and the running → idle progress lifecycle across a controlled pnpm run. Component and browser-plugin client specs pin the paging controls, disabled states, the progress bar with stage/percentage/package/detail, and the injected progress callback's failure path.

## Consequences

Third-party listings are scrapes of public pages and carry limited metadata; installs resolve the real package identity at mutation time, so an entry whose linked repository is unreachable fails with a clear `failed` stage. All extra provider requests obey the existing `requestTimeoutMs` and `responseMaxBytes` bounds. No session, durability, or API schema change: the snapshot gains additive `page`/`pages` fields and the new namespace method, and the browser consumes both through the existing generated Remote contract.
