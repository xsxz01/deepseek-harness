import { afterEach, describe, expect, it, vi } from 'vitest'
import { installSpec, listMarketplace, resolveMarketplaceEntry } from '../src/catalog.ts'
import type { PluginMarketplaceEntryId } from '../src/types.ts'

const options = { maxEntries: 4, requestTimeoutMs: 1_000, responseMaxBytes: 32_000, userAgent: 'test' }
const profile = { dsh: { profile: { bundles: ['installed-plugin'] } } }

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input
  return input instanceof URL ? input.href : input.url
}

function json(value: unknown, headers?: HeadersInit): Response {
  return new Response(JSON.stringify(value), headers === undefined ? { status: 200 } : { status: 200, headers })
}

afterEach(() => { vi.unstubAllGlobals() })

describe('plugin marketplace catalogs', () => {
  it('projects only dsh.do bundles and derives safe repository links', async () => {
    const fetch = vi.fn(async (_input: RequestInfo | URL) => json({ total: 2, items: [
      { id: 'owner/repo', name: 'installed-plugin', displayName: 'Installed', description: 'Bundle', repoOwner: 'owner', repoName: 'repo', repoUrl: 'javascript:alert(1)', npmPackageName: 'installed-plugin', latestVersion: '1.2.3', stars: 9, hasBundle: true, isVerified: true },
      { id: 'owner/client', name: 'client-only', repoOwner: 'different', repoName: 'client', npmPackageName: 'client-only', latestVersion: '../../escape', hasBundle: true },
    ] }))
    vi.stubGlobal('fetch', fetch)

    const result = await listMarketplace('dsh', 'installed', profile, options)
    expect(result).toEqual({
      total: 2,
      entries: [expect.objectContaining({
        id: 'owner/repo', packageName: 'installed-plugin', repositoryUrl: 'https://github.com/owner/repo',
        version: '1.2.3', verified: true, installed: true,
      })],
    })
    expect(fetch.mock.calls[0]?.[0]).toEqual(expect.stringContaining('type=bundle'))
    expect(fetch.mock.calls[0]?.[0]).toEqual(expect.stringContaining('q=installed'))
  })

  it('keeps GitHub repositories only when the package manifest declares dsh.bundle.patch', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = requestUrl(input)
      if (url.includes('/search/repositories')) return json({ total_count: 2, items: [
        { full_name: 'owner/bundle', name: 'bundle', default_branch: 'main', description: 'Works', stargazers_count: 5 },
        { full_name: 'owner/plain', name: 'plain', default_branch: 'main', description: null, stargazers_count: 1 },
      ] })
      if (url.includes('/owner/bundle/')) return json({ name: '@scope/bundle', dsh: { bundle: { patch: './cordis.patch.yml' } } })
      if (url.includes('/owner/plain/')) return json({ name: 'plain' })
      throw new Error('unexpected URL: ' + url)
    }))

    const result = await listMarketplace('github', '', profile, options)
    expect(result.entries).toEqual([
      expect.objectContaining({ id: 'owner/bundle', packageName: '@scope/bundle', repositoryUrl: 'https://github.com/owner/bundle' }),
    ])
  })

  it('re-resolves a GitHub identity and pins installation to its current commit SHA', async () => {
    const sha = 'a'.repeat(40)
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = requestUrl(input)
      if (url.endsWith('/repos/owner/bundle')) return json({ name: 'bundle', default_branch: 'main', topics: ['dsh-plugin'], stargazers_count: 3 })
      if (url.includes('raw.githubusercontent.com')) return json({ name: 'bundle-package', dsh: { bundle: { patch: './cordis.patch.yml' } } })
      if (url.includes('/commits/main')) return json({ sha })
      throw new Error('unexpected URL: ' + url)
    }))

    const candidate = await resolveMarketplaceEntry('github', 'owner/bundle' as PluginMarketplaceEntryId, {}, options)
    await expect(installSpec(candidate, options)).resolves.toBe('github:owner/bundle#' + sha)
  })

  it('rejects oversized source responses including multibyte bytes', async () => {
    const oversized = json({ items: [] }, { 'content-length': '40' })
    vi.stubGlobal('fetch', vi.fn(async () => oversized))
    await expect(listMarketplace('dsh', '', {}, { ...options, responseMaxBytes: 10 })).rejects.toThrow('byte limit')

    const multibyte = json({ total: 0, items: [], note: '中文' })
    vi.stubGlobal('fetch', vi.fn(async () => multibyte))
    await expect(listMarketplace('dsh', '', {}, { ...options, responseMaxBytes: 20 })).rejects.toThrow('byte limit')
  })


  it('rejects HTTP, empty-body, and malformed JSON source responses', async () => {
    for (const response of [
      new Response('failure', { status: 503 }),
      new Response(null, { status: 200 }),
      new Response('{', { status: 200 }),
    ]) {
      vi.stubGlobal('fetch', vi.fn(async () => response))
      await expect(listMarketplace('dsh', '', {}, options)).rejects.toThrow()
    }
  })

  it('drops malformed GitHub search rows and unreadable or invalid manifests', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = requestUrl(input)
      if (url.includes('/search/repositories')) return json({ total_count: -1, items: [
        null,
        { full_name: 'missing-branch/repo' },
        { full_name: 'not-a-repository', default_branch: 'main' },
        { full_name: 'owner/unreadable', default_branch: 'main' },
        { full_name: 'owner/invalid-name', default_branch: 'main' },
      ] })
      if (url.includes('/owner/unreadable/')) return new Response('missing', { status: 404 })
      if (url.includes('/owner/invalid-name/')) return json({ name: 'INVALID NAME', dsh: { bundle: { patch: './patch.yml' } } })
      throw new Error('unexpected URL: ' + url)
    }))
    await expect(listMarketplace('github', '   ', { dsh: null }, options)).resolves.toEqual({ entries: [], total: 0 })
  })

  it('defaults optional dsh.do presentation fields and rejects malformed rows', async () => {
    const invalidRows: unknown[] = [
      null,
      {},
      { id: 'owner/repo' },
      { id: 'owner/repo', repoOwner: 'owner' },
      { id: 'owner/repo', repoOwner: 'owner', repoName: 'repo' },
      { id: 'owner/repo', repoOwner: 'owner', repoName: 'repo', name: 'INVALID NAME', hasBundle: true },
      { id: 'other/repo', repoOwner: 'owner', repoName: 'repo', name: 'plugin', hasBundle: true },
    ]
    vi.stubGlobal('fetch', vi.fn(async () => json({ total: 'unknown', items: [
      ...invalidRows,
      { id: 'owner/fallback', repoOwner: 'owner', repoName: 'fallback', name: 'fallback', npmPackageName: 'different', latestVersion: '../../bad', stars: -1, hasBundle: true },
    ] })))
    const result = await listMarketplace('dsh', '   ', { dsh: { profile: { bundles: [1, 'fallback'] } } }, { ...options, maxEntries: 20 })
    expect(result).toEqual({ total: 0, entries: [expect.objectContaining({
      id: 'owner/fallback', displayName: 'fallback', description: '', version: '../../bad', stars: 0, installed: true,
    })] })
    await expect(installSpec(result.entries[0] as never, options)).rejects.toThrow()
  })

  it('rejects provider entries that cannot be re-resolved for mutation', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = requestUrl(input)
      if (url.includes('dsh.do')) return json({ total: 0, items: [] })
      if (url.endsWith('/repos/owner/plain')) return json({ default_branch: 'main', topics: [] })
      if (url.endsWith('/repos/owner/no-branch')) return json({ topics: ['dsh-plugin'] })
      if (url.endsWith('/repos/owner/no-bundle')) return json({ name: 'no-bundle', default_branch: 'main', topics: ['dsh-plugin'] })
      if (url.includes('/owner/no-bundle/')) return json({ name: 'no-bundle' })
      throw new Error('unexpected URL: ' + url)
    }))
    await expect(resolveMarketplaceEntry('dsh', 'owner/missing' as PluginMarketplaceEntryId, {}, options)).rejects.toThrow('not present')
    await expect(resolveMarketplaceEntry('github', 'owner/plain' as PluginMarketplaceEntryId, {}, options)).rejects.toThrow('not a dsh-plugin')
    await expect(resolveMarketplaceEntry('github', 'owner/no-branch' as PluginMarketplaceEntryId, {}, options)).rejects.toThrow('not a dsh-plugin')
    await expect(resolveMarketplaceEntry('github', 'owner/no-bundle' as PluginMarketplaceEntryId, {}, options)).rejects.toThrow('declares no dsh.bundle')
  })


  it('normalizes missing provider collections and optional GitHub metadata', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = requestUrl(input)
      if (url.includes('/search/repositories')) return json({ total_count: 1, items: [
        { full_name: 'owner/no-name', default_branch: 'main', stargazers_count: 1 },
        { full_name: 'owner/empty-manifest', default_branch: 'main' },
      ] })
      if (url.includes('/owner/no-name/')) return json({ name: 'no-name-package', dsh: { bundle: { patch: './patch.yml' } } })
      if (url.includes('/owner/empty-manifest/')) return json({})
      throw new Error('unexpected URL: ' + url)
    }))
    const github = await listMarketplace('github', '', {}, options)
    expect(github.entries[0]).toEqual(expect.objectContaining({ displayName: 'no-name', description: '' }))

    vi.stubGlobal('fetch', vi.fn(async () => json({ total: 1, items: null })))
    await expect(listMarketplace('dsh', '', {}, options)).resolves.toEqual({ entries: [], total: 1 })
    vi.stubGlobal('fetch', vi.fn(async () => json({ total_count: 1, items: null })))
    await expect(listMarketplace('github', '', {}, options)).resolves.toEqual({ entries: [], total: 1 })

    vi.stubGlobal('fetch', vi.fn(async () => json({ total: 1, items: [{
      id: 'owner/no-version', repoOwner: 'owner', repoName: 'no-version', name: 'no-version', hasBundle: true,
    }] })))
    expect((await listMarketplace('dsh', '', {}, options)).entries[0]?.version).toBeNull()
  })

  it('normalizes optional GitHub metadata while resolving a mutation', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = requestUrl(input)
      if (url.endsWith('/repos/owner/no-topics')) return json({ default_branch: 'main', topics: null })
      if (url.endsWith('/repos/owner/resolved')) return json({ default_branch: 'main', topics: ['dsh-plugin'], description: 'Resolved plugin' })
      if (url.includes('/owner/resolved/')) return json({ name: 'resolved-package', dsh: { bundle: { patch: './patch.yml' } } })
      throw new Error('unexpected URL: ' + url)
    }))
    await expect(resolveMarketplaceEntry('github', 'owner/no-topics' as PluginMarketplaceEntryId, {}, options)).rejects.toThrow('not a dsh-plugin')
    await expect(resolveMarketplaceEntry('github', 'owner/resolved' as PluginMarketplaceEntryId, {}, options)).resolves.toEqual(expect.objectContaining({
      displayName: 'resolved', description: 'Resolved plugin',
    }))
  })

  it('rejects unbounded Remote query and identity inputs before network access', async () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    await expect(listMarketplace('dsh', 'x'.repeat(201), {}, options)).rejects.toThrow('200 characters')
    await expect(resolveMarketplaceEntry('github', 'x'.repeat(201) as PluginMarketplaceEntryId, {}, options)).rejects.toThrow('invalid marketplace plugin id')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('lists dshplugin.io slugs from the sitemap with client-side paging', async () => {
    const xml = `<?xml version="1.0"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://dshplugin.io/plugin/dsh-web-mobile</loc></url>
  <url><loc>https://dshplugin.io/zh/plugin/dsh-web-mobile</loc></url>
  <url><loc>https://dshplugin.io/plugin/dsh-web-lan-access</loc></url>
  <url><loc>https://dshplugin.io/plugin/other-plugin</loc></url>
</urlset>`
    vi.stubGlobal('fetch', vi.fn(async () => new Response(xml, { status: 200 })))

    const first = await listMarketplace('dshplugin', '', {}, options, 1, 2)
    expect(first.entries).toEqual([
      expect.objectContaining({ id: 'dsh-web-mobile', source: 'dshplugin', repositoryUrl: 'https://dshplugin.io/plugin/dsh-web-mobile' }),
      expect.objectContaining({ id: 'dsh-web-lan-access' }),
    ])
    expect(first.total).toBe(3)

    const second = await listMarketplace('dshplugin', '', {}, options, 2, 2)
    expect(second.entries.map(entry => entry.id)).toEqual(['other-plugin'])
  })

  it('filters dshplugin slugs by query and clamps paging bounds', async () => {
    const xml = `<urlset><url><loc>https://dshplugin.io/plugin/dsh-web-mobile</loc></url>
<url><loc>https://dshplugin.io/plugin/web-tools</loc></url></urlset>`
    vi.stubGlobal('fetch', vi.fn(async () => new Response(xml, { status: 200 })))
    const result = await listMarketplace('dshplugin', 'mobile', {}, options, 0, 0)
    expect(result.entries.map(entry => entry.id)).toEqual(['dsh-web-mobile'])
  })

  it('lists dshmarket.com cards from the static browse page', async () => {
    const html = `<ul class="plugin-list">
  <li><a href="/zh/p/ningbainb/deepseek-harness-desktop--packages-dsh-desktop-base/"><span class="owner">ningbainb/</span>deepseek-harness-desktop#packages/dsh-desktop-base</a><p>桌面基础包</p></li>
  <li><a href="/zh/p/owner/plain-plugin/"><span class="owner">owner/</span>plain-plugin</a><p>A plain plugin</p></li>
  <li><a href="/zh/p/owner/other/"><span class="owner">owner/</span>other</a><p>Something else</p></li>
</ul>`
    vi.stubGlobal('fetch', vi.fn(async () => new Response(html, { status: 200 })))
    const result = await listMarketplace('dshmarket', 'desktop', {}, options)
    expect(result.entries).toEqual([
      expect.objectContaining({
        id: 'ningbainb/deepseek-harness-desktop', source: 'dshmarket',
        displayName: 'ningbainb/deepseek-harness-desktop#packages/dsh-desktop-base',
        description: '桌面基础包', repositoryUrl: 'https://github.com/ningbainb/deepseek-harness-desktop',
      }),
    ])
    expect(result.total).toBe(1)
  })

  it('lists dsh.deepseek404.com cards with server-side pages and derives totals', async () => {
    const page1 = `<div class="projects">
  <article class="project-card">
    <p class="project-card__type">技能</p>
    <p class="project-card__description">移动端网关</p>
    <a class="project-card__open" href="detail.php?id=mexiaosqwq%2Fdsh-web-mobile">打开</a>
  </article>
  <article class="project-card">
    <p class="project-card__type">界面</p>
    <p class="project-card__description">第二个插件</p>
    <a class="project-card__open" href="detail.php?id=owner%2Fsecond">打开</a>
  </article>
</div>
<nav class="pagination"><a class="page-link" href="index.php?page=2">2</a><a class="page-link" href="index.php?page=3">3</a></nav>`
    const seen: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      seen.push(requestUrl(input))
      return new Response(page1, { status: 200 })
    }))
    const result = await listMarketplace('dsh404', '', {}, options, 2, 2)
    expect(seen[0]).toContain('page=2')
    expect(result.entries[0]).toEqual(expect.objectContaining({
      id: 'mexiaosqwq/dsh-web-mobile', source: 'dsh404', displayName: 'dsh-web-mobile',
      description: '[技能] 移动端网关', repositoryUrl: 'https://github.com/mexiaosqwq/dsh-web-mobile',
    }))
    expect(result.total).toBe(6)
  })

  it('resolves new-source identities through HEAD GitHub manifests', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = requestUrl(input)
      if (url.includes('dshplugin.io/zh/plugin/detail-plugin')) {
        return new Response('<a href="https://github.com/me/detail-plugin">Source</a><a href="https://github.com/tjsdyy/dshplugin">Site</a>', { status: 200 })
      }
      if (url.includes('raw.githubusercontent.com/me/detail-plugin/HEAD/package.json')) {
        return json({ name: 'detail-package', dsh: { bundle: { patch: './cordis.patch.yml' } } })
      }
      if (url.includes('raw.githubusercontent.com/owner/market-repo/HEAD/package.json')) {
        return json({ name: 'market-package', dsh: { bundle: { patch: './cordis.patch.yml' } } })
      }
      throw new Error('unexpected URL: ' + url)
    }))

    const dshplugin = await resolveMarketplaceEntry('dshplugin', 'detail-plugin' as PluginMarketplaceEntryId, profile, options)
    expect(dshplugin).toEqual(expect.objectContaining({ source: 'dshplugin', packageName: 'detail-package', owner: 'me', repository: 'detail-plugin' }))

    const market = await resolveMarketplaceEntry('dshmarket', 'owner/market-repo' as PluginMarketplaceEntryId, profile, options)
    expect(market).toEqual(expect.objectContaining({ source: 'dshmarket', packageName: 'market-package', installed: false }))
  })

  it('rejects new-source mutations whose detail page exposes no repository or manifest', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = requestUrl(input)
      if (url.includes('dshplugin.io/zh/plugin/no-repo')) return new Response('<p>no source link</p>', { status: 200 })
      if (url.includes('raw.githubusercontent.com/owner/plain-repo/HEAD/package.json')) return json({ name: 'plain-package' })
      throw new Error('unexpected URL: ' + url)
    }))
    await expect(resolveMarketplaceEntry('dshplugin', 'no-repo' as PluginMarketplaceEntryId, {}, options)).rejects.toThrow('no GitHub repository')
    await expect(resolveMarketplaceEntry('dsh404', 'owner/plain-repo' as PluginMarketplaceEntryId, {}, options)).rejects.toThrow('declares no dsh.bundle')
    await expect(resolveMarketplaceEntry('dsh404', 'bad id!' as PluginMarketplaceEntryId, {}, options)).rejects.toThrow('invalid marketplace plugin id')
  })

  it('applies page size caps to every listing provider', async () => {
    const xml = `<urlset>${Array.from({ length: 6 }, (_, i) => `<url><loc>https://dshplugin.io/plugin/plugin-${i}</loc></url>`).join('')}</urlset>`
    vi.stubGlobal('fetch', vi.fn(async () => new Response(xml, { status: 200 })))
    const result = await listMarketplace('dshplugin', '', {}, { ...options, maxEntries: 2 }, 1, 20)
    expect(result.entries).toHaveLength(2)
  })
})
