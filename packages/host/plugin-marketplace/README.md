# @deepseek-ai/dsh-host-plugin-marketplace

English | [中文](README.zh.md)

Host-owned discovery and profile package management for the Web plugin marketplace. `PluginMarketplaceGateway` publishes direct `pluginMarketplace/list`, `pluginMarketplace/addPlugin`, `pluginMarketplace/deletePlugin`, and `pluginMarketplace/progress` Remotes. The browser selects one of five sources and submits an opaque provider id; it never supplies a package-manager spec or command. Listings are paginated with `page` and `pageSize` request fields, and `progress` returns the live stage and percentage of the running mutation for the browser progress bar.

The `dsh` adapter reads `https://dsh.do/api/packages?type=bundle`, accepts only entries with `hasBundle: true` and consistent repository identity, and prefers an exact `npmPackageName@latestVersion` when that npm name equals the package identity. The `github` adapter searches the public `dsh-plugin` topic and includes a repository only when its default-branch `package.json` declares `dsh.bundle.patch`. Git installations resolve the current default-branch commit and use a pinned `github:owner/repository#sha` spec.

The `dshplugin`, `dshmarket`, and `dsh404` adapters scrape public catalog pages: the `dshplugin.io` sitemap (plugin slugs, client-side paging over the full list), the `dshmarket.com` browse page (owner/repository cards with descriptions), and the `dsh.deepseek404.com` card store (server-side `?page=N` pages with type and description). These pages expose no version or star metadata and no npm identity, so their entries list with neutral metadata and mutation resolves the linked GitHub repository's HEAD `package.json` lazily to learn the real package name and bundle declaration.

All provider requests have configurable time, byte, and item bounds. Repository links are reconstructed from validated GitHub owner/repository fields. Install and remove operations run serially through the injected subprocess service as `corepack pnpm`, use collected-output limits and an operation deadline, and publish success only after the profile dependency and `dsh.profile.bundles` agree. While a mutation runs, `progress` reports the resolved-to-installed-to-activated stage with a percentage and the package-manager output tail; failures report the `failed` stage before the mutation rejects. An installed package without `dsh.bundle.patch` is removed before the failed install returns. Successful mutations report `restartRequired: true`; they do not hot-load or unload code.

## Configuration

| Field | Default | Meaning |
| --- | --- | --- |
| `profile` | required | Existing profile managed by this service. |
| `packageManagerExecutable` | `corepack` | Executable that dispatches the pinned `pnpm` command. |
| `requestTimeoutMs` | `15000` | Deadline for each marketplace HTTP request. |
| `responseMaxBytes` | `2097152` | Maximum complete HTTP response body. |
| `operationTimeoutMs` | `300000` | Deadline for one package mutation. |
| `maxEntries` | `24` | Maximum entries retained from one listing, capped at 50. |
| `outputMaxBytes` | `65536` | Collected byte limit for each package-manager output stream. |
| `graceMs` | `5000` | Subprocess termination and pipe-drain grace period. |

## Model Experience

None, as this Host service registers no prompt, tool, message, or provider request.

#### KV Cache effect

None; marketplace data and package operations never enter model input.

## Known Limitations and Deferred Work

- **Restart required** — adding or deleting a dependency changes the next Host composition; code already loaded in the current Host remains active until restart.
- **Public provider limits** — anonymous GitHub search is subject to GitHub rate limits, and provider availability is not cached by this package.
- **Provider-resolved deletion** — removal resolves the selected id against its current provider before changing the profile, so an entry removed from or unreachable through that provider must be removed with the profile package CLI.
- **Trusted code execution** — package installation runs dependency lifecycle scripts and the selected bundle runs trusted Cordis code after restart; catalog verification proves the bundle declaration and identity, not code safety.
