import type { Branded } from '@deepseek-ai/dsh-brand'

/** Marketplace catalog provider selected by the user. */
export type PluginMarketplaceSource = 'github' | 'dsh' | 'dshplugin' | 'dshmarket' | 'dsh404'

/** Opaque provider-owned plugin identity. */
export type PluginMarketplaceEntryId = Branded<'PluginMarketplaceEntryId'>

/** One installable DSH bundle from a marketplace provider. */
export interface PluginMarketplaceEntry {
  id: PluginMarketplaceEntryId
  source: PluginMarketplaceSource
  packageName: string
  displayName: string
  description: string
  repositoryUrl: string
  version: string | null
  stars: number
  verified: boolean
  installed: boolean
}

/** Default marketplace page size served by every provider. */
export const PLUGIN_MARKETPLACE_DEFAULT_PAGE_SIZE = 12

/** Request for one bounded, paginated marketplace listing. */
export interface PluginMarketplaceListRequest {
  source: PluginMarketplaceSource
  query: string
  /** 1-based page number; defaults to the first page. */
  page?: number
  /** Entries per page; defaults to {@link PLUGIN_MARKETPLACE_DEFAULT_PAGE_SIZE}. */
  pageSize?: number
}

/** Current marketplace page and profile state. */
export interface PluginMarketplaceSnapshot {
  source: PluginMarketplaceSource
  entries: PluginMarketplaceEntry[]
  total: number
  page: number
  pages: number
  restartRequired: boolean
}

/** One installation/removal stage shown to the user. */
export type PluginMarketplaceProgressStage = 'resolve' | 'install' | 'activate' | 'done' | 'failed' | 'idle'

/** Live mutation progress polled by the browser while an operation runs. */
export interface PluginMarketplaceProgress {
  status: 'idle' | 'running'
  operation: 'install' | 'remove' | null
  stage: PluginMarketplaceProgressStage
  /** 0-100 percentage of the current operation. */
  percent: number
  packageName: string | null
  detail: string | null
}

/** Exact marketplace identity accepted by mutation methods. */
export interface PluginMarketplaceMutationRequest {
  source: PluginMarketplaceSource
  id: PluginMarketplaceEntryId
}

/** Successful profile mutation result. */
export interface PluginMarketplaceMutationResult {
  packageName: string
  installed: boolean
  restartRequired: true
}
