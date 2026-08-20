import { PLUGIN_MARKETPLACE_DEFAULT_PAGE_SIZE } from './types.ts'
import type { PluginMarketplaceEntry, PluginMarketplaceEntryId, PluginMarketplaceSource } from './types.ts'

const GITHUB_API = 'https://api.github.com'
const GITHUB_RAW = 'https://raw.githubusercontent.com'
const DSH_CATALOG = 'https://dsh.do/api/packages'
const DSHPLUGIN_SITEMAP = 'https://dshplugin.io/sitemap.xml'
const DSHPLUGIN_DETAIL = 'https://dshplugin.io/zh/plugin/'
const DSHPLUGIN_HOME_REPO = 'tjsdyy/dshplugin'
const DSHMARKET_BROWSE = 'https://dshmarket.com/zh/browse/'
const DSH404_BROWSE = 'https://dsh.deepseek404.com/index.php'
const NAME = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/u
const VERSION = /^[0-9][0-9A-Za-z.+-]{0,99}$/u
const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u
const SHA = /^[0-9a-f]{40}$/u

interface Candidate extends PluginMarketplaceEntry {
  owner: string
  repository: string
  defaultBranch: string
  npmSpec: string | null
}

interface ProfileLike {
  dsh?: unknown
}

interface CatalogOptions {
  maxEntries: number
  requestTimeoutMs: number
  responseMaxBytes: number
  userAgent: string
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function finite(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0
}

function entryId(value: string): PluginMarketplaceEntryId {
  return value as PluginMarketplaceEntryId
}

async function fetchJson(url: string, options: CatalogOptions): Promise<unknown> {
  const signal = AbortSignal.timeout(options.requestTimeoutMs)
  const response = await fetch(url, {
    headers: { Accept: 'application/json', 'User-Agent': options.userAgent },
    signal,
  })
  if (!response.ok) throw new Error('marketplace source returned HTTP ' + String(response.status))
  const declared = Number(response.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > options.responseMaxBytes) {
    throw new Error('marketplace source response exceeds the byte limit')
  }
  if (response.body === null) throw new Error('marketplace source returned no response body')
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let bytes = 0
  for (;;) {
    const chunk = await reader.read()
    if (chunk.done) break
    bytes += chunk.value.byteLength
    if (bytes > options.responseMaxBytes) {
      await reader.cancel('marketplace response byte limit reached')
      throw new Error('marketplace source response exceeds the byte limit')
    }
    chunks.push(chunk.value)
  }
  const body = new Uint8Array(bytes)
  let offset = 0
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength }
  return JSON.parse(new TextDecoder().decode(body)) as unknown
}

async function fetchPackageManifest(
  owner: string,
  repository: string,
  branch: string,
  options: CatalogOptions,
): Promise<{ name: string; bundle: boolean } | undefined> {
  const url = GITHUB_RAW + '/' + encodeURIComponent(owner) + '/' + encodeURIComponent(repository)
    + '/' + encodeURIComponent(branch) + '/package.json'
  try {
    const value = record(await fetchJson(url, options))
    const name = text(value?.name)
    const dsh = record(value?.dsh)
    const bundle = record(dsh?.bundle)
    if (name === undefined || name.length > 214 || !NAME.test(name)) return undefined
    return { name, bundle: text(bundle?.patch) !== undefined }
  } catch {
    return undefined
  }
}

async function fetchText(url: string, options: CatalogOptions): Promise<string> {
  const signal = AbortSignal.timeout(options.requestTimeoutMs)
  const response = await fetch(url, {
    headers: { Accept: 'text/html,application/xhtml+xml,application/xml', 'User-Agent': options.userAgent },
    signal,
  })
  if (!response.ok) throw new Error('marketplace source returned HTTP ' + String(response.status))
  if (response.body === null) throw new Error('marketplace source returned no response body')
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let bytes = 0
  for (;;) {
    const chunk = await reader.read()
    if (chunk.done) break
    bytes += chunk.value.byteLength
    if (bytes > options.responseMaxBytes) {
      await reader.cancel('marketplace response byte limit reached')
      throw new Error('marketplace source response exceeds the byte limit')
    }
    chunks.push(chunk.value)
  }
  const body = new Uint8Array(bytes)
  let offset = 0
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength }
  return new TextDecoder().decode(body)
}

function stripTags(value: string): string {
  return value.replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim()
}

/** Slice a fully fetched candidate list into one bounded page, keeping the source total. */
function pageCandidates(
  candidates: Candidate[],
  page: number,
  pageSize: number,
  total: number = candidates.length,
): { entries: Candidate[]; total: number } {
  const start = (page - 1) * pageSize
  return { entries: candidates.slice(start, start + pageSize), total }
}

/** dshplugin.io: the sitemap carries every catalogued plugin slug. */
async function listDshplugin(
  query: string,
  page: number,
  pageSize: number,
  options: CatalogOptions,
): Promise<{ entries: Candidate[]; total: number }> {
  const xml = await fetchText(DSHPLUGIN_SITEMAP, options)
  const prefix = 'https://dshplugin.io/plugin/'
  const slugs = [...new Set([...xml.matchAll(/<loc>([^<]+)<\/loc>/g)]
    .map(match => match[1] ?? '')
    .filter(url => url.startsWith(prefix))
    .map(url => url.slice(prefix.length)))]
  const needle = query.toLowerCase()
  const filtered = slugs.filter(slug => needle === '' || slug.includes(needle))
  const candidates: Candidate[] = filtered.map(slug => ({
    id: entryId(slug), source: 'dshplugin', packageName: slug, displayName: slug,
    description: '', repositoryUrl: prefix + slug, version: null, stars: 0, verified: false,
    installed: false, owner: '', repository: '', defaultBranch: 'HEAD', npmSpec: null,
  }))
  return pageCandidates(candidates, page, pageSize)
}

/** dshmarket.com: one static page lists the whole catalog grouped by category. */
async function listDshmarket(
  query: string,
  page: number,
  pageSize: number,
  options: CatalogOptions,
): Promise<{ entries: Candidate[]; total: number }> {
  const html = await fetchText(DSHMARKET_BROWSE, options)
  const candidates: Candidate[] = []
  for (const match of html.matchAll(/<li>(.*?)<\/li>/gs)) {
    const body = match[1] ?? ''
    const link = body.match(/href="\/zh\/p\/([^/"]+)\/([^/"]+)\/"/)
    if (link === null) continue
    const owner = stripTags(link[1] ?? '')
    const anchor = body.match(/<a[^>]*>(.*?)<\/a>/s)
    const textContent = anchor === null ? '' : stripTags(anchor[1] ?? '')
    const split = textContent.split('/')
    if (split.length < 2) continue
    const repo = ((split[1] ?? '').split('#')[0] ?? '').trim()
    if (!REPOSITORY.test(owner + '/' + repo)) continue
    const description = body.match(/<p>(.*?)<\/p>/s)
    candidates.push({
      id: entryId(owner + '/' + repo), source: 'dshmarket', packageName: owner + '/' + repo,
      displayName: textContent, description: description === null ? '' : stripTags(description[1] ?? ''),
      repositoryUrl: 'https://github.com/' + owner + '/' + repo, version: null, stars: 0, verified: false,
      installed: false, owner, repository: repo, defaultBranch: 'HEAD', npmSpec: null,
    })
  }
  const needle = query.toLowerCase()
  const filtered = candidates.filter(candidate =>
    needle === '' || candidate.displayName.toLowerCase().includes(needle)
      || candidate.description.toLowerCase().includes(needle))
  return pageCandidates(filtered, page, pageSize)
}

/** dsh.deepseek404.com: a server-paginated card catalog. */
async function listDsh404(
  query: string,
  page: number,
  _pageSize: number,
  options: CatalogOptions,
): Promise<{ entries: Candidate[]; total: number }> {
  const url = DSH404_BROWSE + '?page=' + String(Math.max(1, page))
    + (query.trim() === '' ? '' : '&q=' + encodeURIComponent(query.trim()))
  const html = await fetchText(url, options)
  const maxPage = Math.max(1, ...[...html.matchAll(/href="index\.php\?page=(\d+)"/g)]
    .map(match => Number(match[1] ?? '')).filter(Number.isFinite))
  const candidates: Candidate[] = []
  for (const match of html.matchAll(/<article class="project-card">(.*?)<\/article>/gs)) {
    const card = match[1] ?? ''
    const link = card.match(/<a class="project-card__open" href="detail\.php\?id=([^"]+)"/)
    if (link === null) continue
    const id = decodeURIComponent(link[1] ?? '')
    if (!REPOSITORY.test(id)) continue
    const type = card.match(/project-card__type">([^<]*)</)
    const description = card.match(/project-card__description">([^<]*)</)
    const name = id.split('/')[1] ?? id
    const [owner, repository] = id.split('/') as [string, string]
    candidates.push({
      id: entryId(id), source: 'dsh404', packageName: id, displayName: name,
      description: (type === null ? '' : '[' + stripTags(type[1] ?? '') + '] ')
        + (description === null ? '' : stripTags(description[1] ?? '')),
      repositoryUrl: 'https://github.com/' + id, version: null, stars: 0, verified: false,
      installed: false, owner, repository, defaultBranch: 'HEAD', npmSpec: null,
    })
  }
  const perPage = Math.max(candidates.length, 1)
  const total = Math.max(candidates.length, maxPage * perPage)
  return { entries: candidates, total }
}

/** Resolve the npm package name of a GitHub repository through its HEAD manifest. */
async function resolveRawGitHub(
  source: PluginMarketplaceSource,
  id: string,
  owner: string,
  repository: string,
  profile: ProfileLike,
  options: CatalogOptions,
): Promise<Candidate> {
  const manifest = await fetchPackageManifest(owner, repository, 'HEAD', options)
  if (manifest === undefined) throw new Error('repository package.json is not reachable')
  if (!manifest.bundle) throw new Error('repository package declares no dsh.bundle')
  return {
    id: entryId(id), source, packageName: manifest.name, displayName: repository,
    description: '', repositoryUrl: 'https://github.com/' + owner + '/' + repository,
    version: null, stars: 0, verified: false, installed: installedBundles(profile).has(manifest.name),
    owner, repository, defaultBranch: 'HEAD', npmSpec: null,
  }
}

function installedBundles(profile: ProfileLike): Set<string> {
  const dsh = record(profile.dsh)
  const profileConfig = record(dsh?.profile)
  const bundles = Array.isArray(profileConfig?.bundles) ? profileConfig.bundles : []
  return new Set(bundles.filter((value): value is string => typeof value === 'string'))
}

async function listGithub(
  query: string,
  profile: ProfileLike,
  options: CatalogOptions,
): Promise<{ entries: Candidate[]; total: number }> {
  const search = ['topic:dsh-plugin', query.trim()].filter(Boolean).join(' ')
  const url = new URL(GITHUB_API + '/search/repositories')
  url.searchParams.set('q', search)
  url.searchParams.set('sort', 'stars')
  url.searchParams.set('order', 'desc')
  url.searchParams.set('per_page', String(options.maxEntries))
  const root = record(await fetchJson(url.toString(), options))
  const items = Array.isArray(root?.items) ? root.items : []
  const installed = installedBundles(profile)
  const entries = (await Promise.all(items.slice(0, options.maxEntries).map(async (raw): Promise<Candidate | undefined> => {
    const item = record(raw)
    const fullName = text(item?.full_name)
    const branch = text(item?.default_branch)
    if (fullName === undefined || branch === undefined || !REPOSITORY.test(fullName)) return undefined
    const [owner, repository] = fullName.split('/') as [string, string]
    const manifest = await fetchPackageManifest(owner, repository, branch, options)
    if (manifest === undefined || !manifest.bundle) return undefined
    return {
      id: entryId(fullName),
      source: 'github',
      packageName: manifest.name,
      displayName: text(item?.name) ?? repository,
      description: typeof item?.description === 'string' ? item.description : '',
      repositoryUrl: 'https://github.com/' + fullName,
      version: null,
      stars: finite(item?.stargazers_count),
      verified: false,
      installed: installed.has(manifest.name),
      owner,
      repository,
      defaultBranch: branch,
      npmSpec: null,
    }
  }))).filter((item): item is Candidate => item !== undefined)
  return { entries, total: finite(root?.total_count) }
}

function dshCandidate(raw: unknown, installed: Set<string>): Candidate | undefined {
  const item = record(raw)
  const id = text(item?.id)
  const owner = text(item?.repoOwner)
  const repository = text(item?.repoName)
  const packageName = text(item?.name)
  if (id === undefined || owner === undefined || repository === undefined || packageName === undefined
    || id !== owner + '/' + repository || !REPOSITORY.test(id) || packageName.length > 214
    || !NAME.test(packageName) || item?.hasBundle !== true) return undefined
  const npmName = text(item.npmPackageName)
  const version = text(item.latestVersion)
  const npmSpec = npmName === packageName && version !== undefined && VERSION.test(version)
    ? npmName + '@' + version
    : null
  return {
    id: entryId(id),
    source: 'dsh',
    packageName,
    displayName: text(item.displayName) ?? packageName,
    description: typeof item.description === 'string' ? item.description : '',
    repositoryUrl: 'https://github.com/' + id,
    version: version ?? null,
    stars: finite(item.stars),
    verified: item.isVerified === true,
    installed: installed.has(packageName),
    owner,
    repository,
    defaultBranch: 'HEAD',
    npmSpec,
  }
}

async function listDsh(
  query: string,
  profile: ProfileLike,
  options: CatalogOptions,
): Promise<{ entries: Candidate[]; total: number }> {
  const url = new URL(DSH_CATALOG)
  url.searchParams.set('type', 'bundle')
  if (query.trim().length > 0) url.searchParams.set('q', query.trim())
  const root = record(await fetchJson(url.toString(), options))
  const installed = installedBundles(profile)
  const items = Array.isArray(root?.items) ? root.items : []
  const entries = items.slice(0, options.maxEntries)
    .map(item => dshCandidate(item, installed))
    .filter((item): item is Candidate => item !== undefined)
  return { entries, total: finite(root?.total) }
}

/**
 * Read and validate one provider listing.
 * @param source - provider selected by the user.
 * @param query - bounded provider search text.
 * @param profile - current profile manifest used to annotate installed bundles.
 * @param options - external request and result bounds.
 * @returns normalized provider entries and the provider-reported total.
 */
export async function listMarketplace(
  source: PluginMarketplaceSource,
  query: string,
  profile: ProfileLike,
  options: CatalogOptions,
  page = 1,
  pageSize = PLUGIN_MARKETPLACE_DEFAULT_PAGE_SIZE,
): Promise<{ entries: Candidate[]; total: number }> {
  if (query.length > 200) throw new Error('marketplace query exceeds 200 characters')
  const boundedPage = Math.max(1, Math.floor(page))
  const boundedPageSize = Math.min(Math.max(1, Math.floor(pageSize)), options.maxEntries)
  switch (source) {
    case 'github': {
      const result = await listGithub(query, profile, options)
      return pageCandidates(result.entries, boundedPage, boundedPageSize, result.total)
    }
    case 'dsh': {
      const result = await listDsh(query, profile, options)
      return pageCandidates(result.entries, boundedPage, boundedPageSize, result.total)
    }
    case 'dshplugin':
      return await listDshplugin(query, boundedPage, boundedPageSize, options)
    case 'dshmarket':
      return await listDshmarket(query, boundedPage, boundedPageSize, options)
    case 'dsh404':
      return await listDsh404(query, boundedPage, boundedPageSize, options)
  }
}

/**
 * Resolve one mutation identity against its authoritative provider.
 * @param source - provider that issued the opaque entry id.
 * @param id - bounded provider identity selected by the user.
 * @param profile - current profile manifest used to derive installed state.
 * @param options - external request and result bounds.
 * @returns a provider-verified package candidate.
 */
export async function resolveMarketplaceEntry(
  source: PluginMarketplaceSource,
  id: PluginMarketplaceEntryId,
  profile: ProfileLike,
  options: CatalogOptions,
): Promise<Candidate> {
  if (id.length > 200) throw new Error('invalid marketplace plugin id')
  if (source === 'dsh') {
    if (!REPOSITORY.test(id)) throw new Error('invalid marketplace plugin id')
    const result = await listDsh(id, profile, { ...options, maxEntries: Math.max(options.maxEntries, 20) })
    const candidate = result.entries.find(item => item.id === id)
    if (candidate === undefined) throw new Error('plugin is not present in the dsh.do bundle catalog')
    return candidate
  }
  if (source === 'dshmarket' || source === 'dsh404') {
    if (!REPOSITORY.test(id)) throw new Error('invalid marketplace plugin id')
    const [owner, repository] = id.split('/') as [string, string]
    return await resolveRawGitHub(source, id, owner, repository, profile, options)
  }
  if (source === 'dshplugin') {
    if (!/^[A-Za-z0-9_.-]{1,120}$/u.test(id)) throw new Error('invalid marketplace plugin id')
    const detail = await fetchText(DSHPLUGIN_DETAIL + encodeURIComponent(id), options)
    const links = [...new Set([...detail.matchAll(/https?:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)/g)]
      .map(match => match[1] + '/' + match[2]))]
    const repositoryId = links.find(candidate => candidate !== DSHPLUGIN_HOME_REPO)
    if (repositoryId === undefined) throw new Error('plugin detail page exposes no GitHub repository')
    const [owner, repository] = repositoryId.split('/') as [string, string]
    return await resolveRawGitHub('dshplugin', id, owner, repository, profile, options)
  }
  const [owner, repository] = id.split('/') as [string, string]
  const item = record(await fetchJson(GITHUB_API + '/repos/' + id, options))
  const topics = Array.isArray(item?.topics) ? item.topics : []
  const branch = text(item?.default_branch)
  if (!topics.includes('dsh-plugin') || branch === undefined) throw new Error('repository is not a dsh-plugin')
  const manifest = await fetchPackageManifest(owner, repository, branch, options)
  if (manifest === undefined || !manifest.bundle) throw new Error('repository package declares no dsh.bundle')
  return {
    id, source, packageName: manifest.name, displayName: text(item?.name) ?? repository,
    description: typeof item?.description === 'string' ? item.description : '',
    repositoryUrl: 'https://github.com/' + id,
    version: null, stars: finite(item?.stargazers_count), verified: false,
    installed: installedBundles(profile).has(manifest.name), owner, repository,
    defaultBranch: branch, npmSpec: null,
  }
}

/**
 * Build a deterministic pnpm add spec for one resolved candidate.
 * @param candidate - provider-verified package candidate.
 * @param options - external request bounds used when resolving a Git commit.
 * @returns an exact npm version or commit-pinned GitHub package spec.
 */
export async function installSpec(candidate: Candidate, options: CatalogOptions): Promise<string> {
  if (candidate.npmSpec !== null) return candidate.npmSpec
  const root = record(await fetchJson(
    GITHUB_API + '/repos/' + candidate.owner + '/' + candidate.repository + '/commits/'
      + encodeURIComponent(candidate.defaultBranch),
    options,
  ))
  const sha = text(root?.sha)
  if (sha === undefined || !SHA.test(sha)) throw new Error('GitHub did not return a commit SHA')
  return 'github:' + candidate.owner + '/' + candidate.repository + '#' + sha
}
