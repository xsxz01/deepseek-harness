# @deepseek-ai/dsh-host-plugin-marketplace

[English](README.md) | 中文

Web 插件市场的 Host 侧发现与 profile 包管理。`PluginMarketplaceGateway` 发布直接 Remote：`pluginMarketplace/list`、`pluginMarketplace/addPlugin`、`pluginMarketplace/deletePlugin` 与 `pluginMarketplace/progress`。浏览器从五个来源中选择并提交不透明的提供方 id；它不会提交包管理器 spec 或命令。列表通过 `page` 与 `pageSize` 请求字段分页，`progress` 返回进行中变更的实时阶段与百分比，供浏览器进度条展示。

`dsh` adapter 读取 `https://dsh.do/api/packages?type=bundle`，只接受 `hasBundle: true` 且仓库身份一致的条目；当 npm 名称等于包身份时，优先使用精确的 `npmPackageName@latestVersion`。`github` adapter 搜索公开的 `dsh-plugin` topic，并且只在默认分支 `package.json` 声明 `dsh.bundle.patch` 时收录仓库。Git 安装会解析默认分支的当前 commit，并使用固定的 `github:owner/repository#sha` spec。

`dshplugin`、`dshmarket` 与 `dsh404` adapter 抓取公开目录页：`dshplugin.io` 的 sitemap（插件 slug，整表客户端分页）、`dshmarket.com` 浏览页（带描述的 owner/repository 卡片）与 `dsh.deepseek404.com` 卡片商店（服务端 `?page=N` 分页，含类型与描述）。这些页面不暴露版本、star 或 npm 身份，因此条目以中性元数据列出；变更操作会惰性解析关联 GitHub 仓库 HEAD 的 `package.json`，以获知真实包名与 bundle 声明。

所有提供方请求都受可配置的时间、字节与条目数限制。仓库链接根据经过校验的 GitHub owner/repository 字段重建。安装与删除操作通过注入的 subprocess 服务串行运行 `corepack pnpm`，使用有界收集输出与操作 deadline，并且只在 profile dependency 与 `dsh.profile.bundles` 一致后报告成功。变更运行期间，`progress` 报告从解析到安装再到激活的阶段、百分比与包管理器输出尾部；失败会在变更 reject 前报告 `failed` 阶段。已安装但不含 `dsh.bundle.patch` 的包会在失败的安装返回前被删除。成功变更报告 `restartRequired: true`；服务不会热加载或热卸载代码。

## 配置

| 字段 | 默认值 | 含义 |
| --- | --- | --- |
| `profile` | 必填 | 本服务管理的现有 profile。 |
| `packageManagerExecutable` | `corepack` | 分派固定 `pnpm` 命令的可执行文件。 |
| `requestTimeoutMs` | `15000` | 每次市场 HTTP 请求的 deadline。 |
| `responseMaxBytes` | `2097152` | 完整 HTTP 响应正文的最大字节数。 |
| `operationTimeoutMs` | `300000` | 一次包变更的 deadline。 |
| `maxEntries` | `24` | 单次列表保留的最大条目数，上限为 50。 |
| `outputMaxBytes` | `65536` | 每个包管理器输出 stream 的收集字节限制。 |
| `graceMs` | `5000` | subprocess 终止与 pipe 排空的宽限期。 |

## 模型体验

无，因为这个 Host 服务不注册提示词、工具、消息或提供方请求。

#### KV Cache 影响

无；市场数据与包操作绝不会进入模型输入。

## 已知限制与暂缓事项

- **需要重启** —— 添加或删除 dependency 会改变下一次 Host 组合；当前 Host 中已经加载的代码会保持活动，直到重启。
- **公开提供方限制** —— 匿名 GitHub 搜索受 GitHub rate limit 约束，本包不缓存提供方可用性。
- **由提供方解析删除操作** —— 删除前会根据当前提供方重新解析所选 id；如果条目已从提供方移除或提供方不可访问，必须使用 profile 包 CLI 删除。
- **执行受信任代码** —— 包安装会运行 dependency lifecycle script，所选 bundle 会在重启后运行受信任的 Cordis 代码；目录校验只证明 bundle 声明与身份，不证明代码安全性。
