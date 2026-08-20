// @vitest-environment jsdom
import { cleanup } from '@testing-library/react'
import { Context, Service } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import { usePinnedBrowserLanguages } from '@deepseek-ai/dsh-client-test-runtime'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import { apply, inject } from '../src/client/index.ts'
import { PluginMarketplaceSettingsTab, type PluginMarketplaceSettingsTabInjected } from '../src/client/PluginMarketplaceSettingsTab.tsx'

usePinnedBrowserLanguages('zh-CN')
afterEach(cleanup)

async function bench() {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const locale = new LocaleRuntime(ctx)
  ctx.provide('locale', locale)
  class RemoteService extends Service {
    constructor(serviceCtx: Context) { super(serviceCtx, 'remote') }
  }
  new RemoteService(ctx)
  const empty = { source: 'dsh' as const, entries: [], total: 0, page: 1, pages: 1, restartRequired: false }
  const changed = { packageName: 'plugin', installed: true, restartRequired: true as const }
  const list = vi.fn(async () => ({ ok: true as const, value: empty }))
  const install = vi.fn(async () => ({ ok: true as const, value: changed }))
  const remove = vi.fn(async () => ({ ok: true as const, value: { ...changed, installed: false } }))
  const progress = vi.fn(async () => ({ ok: true as const, value: { status: 'idle' as const, operation: null, stage: 'idle' as const, percent: 0, packageName: null, detail: null } }))
  ctx.provide('remote.pluginMarketplace', { list, addPlugin: install, deletePlugin: remove, progress })
  const slots = ctx.get('slots') as SlotRegistry
  return { ctx, slots, locale, list, install, remove, progress }
}

function declare(slots: SlotRegistry): () => void {
  return slots.register({ name: 'root', children: { 'settings.plugins.tab': { kind: 'list', scope: 'root' } } } as never, () => null)
}

describe('ui-settings-plugin-marketplace browser plugin', () => {
  it('registers localized Remote callbacks and leaves with its fiber', async () => {
    expect(inject).toEqual(['slots', 'locale', 'remote', 'remote.pluginMarketplace'])
    const b = await bench()
    declare(b.slots)
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()

    const entry = b.slots.entries('settings.plugins.tab')[0]!
    expect(entry.component).toBe(PluginMarketplaceSettingsTab)
    expect(entry.options).toMatchObject({ id: 'marketplace', order: 5 })
    expect(entry.locale).toBe('settings.pluginMarketplace')
    expect(resolveSlotLabel(entry.options.label)).toBe('插件市场')
    const callbacks = (entry.inject as unknown as () => PluginMarketplaceSettingsTabInjected)()
    await expect(callbacks.list('dsh', '')).resolves.toMatchObject({ source: 'dsh', entries: [] })
    await expect(callbacks.progress()).resolves.toMatchObject({ status: 'idle', stage: 'idle' })
    await expect(callbacks.install('dsh', 'owner/plugin' as never)).resolves.toMatchObject({ installed: true })
    await expect(callbacks.remove('dsh', 'owner/plugin' as never)).resolves.toMatchObject({ installed: false })

    b.locale.setLocale('en')
    expect(resolveSlotLabel(entry.options.label)).toBe('Marketplace')
    b.list.mockResolvedValueOnce({ ok: false, error: { code: 'REMOTE_ERROR', message: 'unavailable' } } as never)
    await expect(callbacks.list('dsh', '')).rejects.toThrow('pluginMarketplace.list failed: REMOTE_ERROR: unavailable')
    b.install.mockResolvedValueOnce({ ok: false, error: { code: 'DENIED', message: 'blocked' } } as never)
    await expect(callbacks.install('dsh', 'owner/plugin' as never)).rejects.toThrow('pluginMarketplace.install failed: DENIED: blocked')
    b.remove.mockResolvedValueOnce({ ok: false, error: { code: 'FAILED', message: 'busy' } } as never)
    await expect(callbacks.remove('dsh', 'owner/plugin' as never)).rejects.toThrow('pluginMarketplace.remove failed: FAILED: busy')
    b.progress.mockResolvedValueOnce({ ok: false, error: { code: 'REMOTE_ERROR', message: 'unavailable' } } as never)
    await expect(callbacks.progress()).rejects.toThrow('pluginMarketplace.progress failed: REMOTE_ERROR: unavailable')

    await fiber.dispose()
    expect(b.slots.entries('settings.plugins.tab')).toHaveLength(0)
    expect(() => b.locale.register('settings.pluginMarketplace' as never, 'zh', {})).not.toThrow()
    await b.ctx.fiber.dispose()
  })
})
