# @deepseek-ai/dsh-client-ui-settings-plugin-marketplace

English | [中文](README.zh.md)

Web Settings contribution for browsing and managing profile plugins. The package registers the `marketplace` entry in `settings.plugins.tab` before the read-only inventory entry. Its segmented source control selects among `dsh.do`, GitHub, `dshplugin.io`, `dshmarket.com`, and the dsh.deepseek404.com card store; search submits a bounded Host query, refresh repeats the current query, and prev/next controls page through the Host-derived page count. Each result exposes its package identity, description, version, verification state, stars, repository, and installed state.

Install and remove buttons call only the generated `pluginMarketplace` Remote callbacks injected at registration. One mutation is visible at a time; while it runs, the tab polls the injected `progress` callback every 400 ms and renders a percentage bar with the current stage, the resolved package name, and the package-manager output tail. Completion refreshes the Host-derived installed state and reports that restart is required. Provider and package-manager diagnostics remain on the Host and the component renders localized generic failures.

## Model Experience

None, as this presentation package registers no prompt, tool, message, or provider request.

#### KV Cache effect

None; the marketplace UI never assembles model input.

## Known Limitations and Deferred Work

- **No live activation state** — installed state comes from the profile manifest and does not claim that the package is active in the current Host; the adjacent inventory tab remains the Loader-state authority.
- **Third-party catalog scraping** — the `dshplugin`, `dshmarket`, and `dsh404` sources derive listings from public sitemap/HTML pages; those pages carry no version, star, or npm identity, and the linked GitHub repository is resolved only when an entry is installed.
