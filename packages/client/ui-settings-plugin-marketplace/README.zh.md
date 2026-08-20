# @deepseek-ai/dsh-client-ui-settings-plugin-marketplace

[English](README.md) | 中文

用于浏览和管理 profile 插件的 Web 设置贡献。本包在只读插件列表条目之前，把 `marketplace` 条目注册到 `settings.plugins.tab`。segmented 数据源控件可在 `dsh.do`、GitHub、`dshplugin.io`、`dshmarket.com` 与 dsh.deepseek404.com 卡片商店之间切换；搜索会提交有界的 Host 查询，刷新会重复当前查询，上一页/下一页按钮会翻动 Host 派生的页码。每条结果会显示包身份、描述、版本、认证状态、stars、仓库与安装状态。

安装与删除按钮只调用注册时注入的生成版 `pluginMarketplace` Remote callback。同一时刻只显示一项变更；运行期间，选项卡每 400 ms 轮询注入的 `progress` callback，并渲染带当前阶段、解析出的包名与包管理器输出尾部的百分比进度条。完成后刷新由 Host 派生的安装状态，并提示需要重启。提供方与包管理器诊断保留在 Host，组件只渲染本地化的通用失败信息。

## 模型体验

无，因为这个呈现包不注册提示词、工具、消息或提供方请求。

#### KV Cache 影响

无；插件市场 UI 绝不会组装模型输入。

## 已知限制与暂缓事项

- **不表示实时激活状态** —— 安装状态来自 profile manifest，不声称包已经在当前 Host 激活；相邻的插件列表选项卡仍是 Loader 状态权威。
- **第三方目录抓取** —— `dshplugin`、`dshmarket` 与 `dsh404` 来源从公开 sitemap/HTML 页面派生列表；这些页面不携带版本、star 或 npm 身份，关联的 GitHub 仓库只在安装条目时才被解析。
