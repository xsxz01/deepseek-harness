import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import { PluginMarketplaceSettingsTab, type PluginMarketplaceSettingsTabInjected } from './PluginMarketplaceSettingsTab.tsx'
import { en, zh, type PluginMarketplaceLocaleKey } from './locales.ts'

export type { PluginMarketplaceSettingsTabInjected, PluginMarketplaceSettingsTabProps } from './PluginMarketplaceSettingsTab.tsx'
export type { PluginMarketplaceLocaleKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' { interface LocaleNamespaceMap { 'settings.pluginMarketplace': PluginMarketplaceLocaleKey } }
const NS = 'settings.pluginMarketplace'
export const inject = ['slots', 'locale', 'remote', 'remote.pluginMarketplace']

export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-settings-plugin-marketplace: dictionaries')
  const t = ctx.locale.bind(NS)
  const list: PluginMarketplaceSettingsTabInjected['list'] = async (source, query, page) => {
    const result = await ctx.remote.pluginMarketplace.list({ source, query, ...(page === undefined ? {} : { page }) })
    if (!result.ok) throw new Error('pluginMarketplace.list failed: ' + result.error.code + ': ' + result.error.message)
    return result.value
  }
  const install: PluginMarketplaceSettingsTabInjected['install'] = async (source, id) => {
    const result = await ctx.remote.pluginMarketplace.addPlugin({ source, id })
    if (!result.ok) throw new Error('pluginMarketplace.install failed: ' + result.error.code + ': ' + result.error.message)
    return result.value
  }
  const remove: PluginMarketplaceSettingsTabInjected['remove'] = async (source, id) => {
    const result = await ctx.remote.pluginMarketplace.deletePlugin({ source, id })
    if (!result.ok) throw new Error('pluginMarketplace.remove failed: ' + result.error.code + ': ' + result.error.message)
    return result.value
  }
  const progress: PluginMarketplaceSettingsTabInjected['progress'] = async () => {
    const result = await ctx.remote.pluginMarketplace.progress()
    if (!result.ok) throw new Error('pluginMarketplace.progress failed: ' + result.error.code + ': ' + result.error.message)
    return result.value
  }
  const injected = (): PluginMarketplaceSettingsTabInjected => ({ list, install, remove, progress })
  ctx.slots.inject('settings.plugins.tab', () => ctx.slots.register({
    name: 'settings.plugins.tab', id: 'marketplace', order: 5, label: () => t('tab'), locale: NS, inject: injected,
  }, PluginMarketplaceSettingsTab))
}
