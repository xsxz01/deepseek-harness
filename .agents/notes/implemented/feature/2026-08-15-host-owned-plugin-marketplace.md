# Agent Note: Host-owned plugin marketplace

Status: implemented

English | [中文](2026-08-15-host-owned-plugin-marketplace.zh.md)

## Problem

A graphical marketplace must discover third-party bundles without allowing browser code or remote catalog fields to become package-manager authority. Discovery results can be stale, malformed, oversized, or controlled by an external service. Installation also changes an executable profile package, runs dependency lifecycle scripts, and cannot safely imply that code has entered or left the live Host.

The Harness already has one external distribution unit and one installation authority: profile dependencies whose packages declare `dsh.bundle.patch`, managed by pnpm and reconciled into `dsh.profile.bundles` ([profile plugin bundles](../architecture/2026-08-05-profile-plugin-bundles.md)). A marketplace-specific manifest, cache, loader, or command language would recreate the separate repository-plugin path that the [single external distribution decision](../simplification/2026-08-09-remove-repository-plugin.md) removed.

## Decision

The marketplace is a Host capability with two provider adapters and one generated Remote namespace. The `dsh` adapter consumes `https://dsh.do/api/packages?type=bundle`; the `github` adapter searches repositories with the `dsh-plugin` topic and reads their default-branch package manifests. Both adapters emit the same bounded catalog entry type and accept only packages that identify an installable bundle. Installed state comes from the profile manifest, while the existing Loader inventory remains the authority for code active in the current Host.

The browser sends only a provider discriminator, bounded query, and opaque provider id. On mutation, the Host resolves that id again against the selected provider and reconstructs the package spec from validated fields. Exact npm versions are used only when catalog package identity and npm identity agree. GitHub packages are pinned to the current default-branch commit SHA. Catalog-provided install commands and repository URLs are never executed or trusted; visible GitHub links are reconstructed from validated owner and repository names.

Provider requests have deployment-configured item, byte, and time limits. Package mutations are serialized and run through the subprocess service as `corepack pnpm` with bounded collected output, a caller-owned deadline, and the service's scrubbed environment. A successful install requires the dependency to exist under its expected package name and its installed manifest to declare `dsh.bundle.patch`; verification failure removes the dependency. The profile bundle list changes only after pnpm succeeds. Every successful mutation reports `restartRequired: true` because the running Loader graph is not hot-mutated.

The Settings contribution is a separate client plugin registered under `settings.plugins.tab`. It owns source selection, submitted search, loading and failure states, one visible mutation state, and the restart notice. Remote callbacks enter through the slot injection face; the component receives no Cordis context or Host service.

## Alternatives considered

**Fetch catalogs and invoke installation from the browser.** Rejected because it exposes provider CORS and credentials to the page, gives untrusted catalog strings a path to local execution, and bypasses profile serialization and verification.

**Add a marketplace-specific package database and loader.** Rejected because profile dependencies, pnpm lockfiles, and bundle patches already own acquisition, versioning, lifecycle scripts, and composition. A second database would revive two installation authorities.

**Install GitHub default branches without a commit pin.** Rejected because the reviewed catalog entry and installed source could move between resolution and installation, and restart could produce a different package from the same operation.

**Hot-load and hot-unload marketplace packages.** Rejected because package installation mutates dependencies and may run arbitrary setup, while deleting a dependency cannot revoke code already evaluated in the current process. Restart gives one clear activation point.

**Merge marketplace state into the Loader inventory tab.** Rejected because candidates and installed profile dependencies are package state, while inventory entries are current Loader/Fiber state. Keeping separate tabs avoids presenting installation as activation.

## Verification

Host tests pin dsh.do and GitHub filtering, safe repository reconstruction, exact response-byte enforcement including multibyte bodies, bounded wire inputs, commit-pinned Git specs, generated Remote methods, successful and concurrent profile reconciliation, bounded subprocess failures, remove reconciliation, and rollback failures for a package without a bundle declaration. Client tests pin source changes, submitted search, refresh, install/remove states, generic failure containment, localized slot registration, and disposer behavior. The desktop Host test proves its selected Node distribution is first on PATH so bundled Corepack is available. The assembled Web browser scenario verifies the marketplace tab through the real profile composition.

## Consequences

- The marketplace adds no distribution format: CLI and GUI installations converge on profile dependencies and bundle patches.
- External responses and diagnostics remain Host-owned and bounded; the page receives normalized entries and generic operation failures.
- GitHub discovery requires extra manifest requests and is subject to public API rate limits; the package does not add a persistent catalog cache.
- Installation executes third-party package code by design. Bundle declaration checks prevent non-bundle dependencies from being retained, but they are not a code-safety review.
- Installed and active remain distinct states until restart, preserving Loader lifecycle authority.
