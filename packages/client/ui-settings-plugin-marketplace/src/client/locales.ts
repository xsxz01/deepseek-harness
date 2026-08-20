/** Copy dictionaries for the plugin marketplace Settings tab. */
export const zh = {
  tab: '插件市场', github: 'GitHub', dsh: 'dsh.do', dshplugin: 'dshplugin.io', dshmarket: 'dshmarket', dsh404: 'DSH 插件商店', source: '数据源',
  search: '搜索市场插件', submitSearch: '搜索', refresh: '刷新',
  loading: '正在读取插件市场…', error: '暂时无法读取插件市场。', retry: '重试', empty: '该数据源暂无可安装插件。', results: '市场插件',
  install: '安装', remove: '删除', installing: '正在安装…', removing: '正在删除…', installed: '已安装', verified: '已认证', version: '版本', stars: 'Stars',
  operationError: '操作失败，请检查插件来源或网络后重试。', restartRequired: '插件变更将在重启应用后生效。',
  previousPage: '上一页', nextPage: '下一页', page: '第',
  progress: '安装进度', resolve: '解析插件', activate: '激活配置', done: '完成', failed: '失败', idle: '空闲',
} satisfies Record<string, string>

/** Translation keys owned by the marketplace tab. */
export type PluginMarketplaceLocaleKey = keyof typeof zh

/** English copy dictionary paired with {@link zh}. */
export const en = {
  tab: 'Marketplace', github: 'GitHub', dsh: 'dsh.do', dshplugin: 'dshplugin.io', dshmarket: 'dshmarket', dsh404: 'DSH Plugin Store', source: 'Source',
  search: 'Search marketplace plugins', submitSearch: 'Search', refresh: 'Refresh',
  loading: 'Loading plugin marketplace…', error: 'The plugin marketplace is temporarily unavailable.', retry: 'Retry', empty: 'No installable plugins are available from this source.', results: 'Marketplace plugins',
  install: 'Install', remove: 'Remove', installing: 'Installing…', removing: 'Removing…', installed: 'Installed', verified: 'Verified', version: 'Version', stars: 'Stars',
  operationError: 'The operation failed. Check the plugin source or network and retry.', restartRequired: 'Plugin changes take effect after the application restarts.',
  previousPage: 'Previous page', nextPage: 'Next page', page: 'Page',
  progress: 'Installation progress', resolve: 'Resolving plugin', activate: 'Activating', done: 'Done', failed: 'Failed', idle: 'Idle',
} satisfies Record<PluginMarketplaceLocaleKey, string>
