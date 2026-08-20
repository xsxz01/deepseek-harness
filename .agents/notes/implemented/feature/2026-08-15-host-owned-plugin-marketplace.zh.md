# Agent Note: Host 管理的插件市场

Status: implemented

[English](2026-08-15-host-owned-plugin-marketplace.md) | 中文

## 问题

图形化市场需要发现第三方 bundle，同时不能让浏览器代码或远程目录字段成为包管理器权威。发现结果可能过期、畸形、超大或受外部服务控制。安装还会修改可执行的 profile 包、运行 dependency lifecycle script，并且不能暗示代码已经进入或离开 live Host。

Harness 已有唯一的外部分发单元和安装权威：声明 `dsh.bundle.patch` 的 profile dependency，由 pnpm 管理并调和到 `dsh.profile.bundles`（[profile 插件 bundle](../architecture/2026-08-05-profile-plugin-bundles.md)）。市场专用 manifest、cache、loader 或命令语言会重新建立[单一外部分发决策](../simplification/2026-08-09-remove-repository-plugin.md)已经移除的独立 repository-plugin 路径。

## 决策

插件市场是一个 Host capability，包含两个 provider adapter 和一个生成的 Remote namespace。`dsh` adapter 消费 `https://dsh.do/api/packages?type=bundle`；`github` adapter 搜索带有 `dsh-plugin` topic 的仓库，并读取默认分支的 package manifest。两个 adapter 都产生相同的有界目录条目类型，并且只接受能够识别为可安装 bundle 的包。安装状态来自 profile manifest；现有 Loader inventory 继续作为当前 Host 中活动代码的权威。

浏览器只发送 provider 判别字段、有界查询和不透明 provider id。执行变更时，Host 会向所选 provider 重新解析该 id，并根据经过校验的字段重建 package spec。只有目录包身份与 npm 身份一致时才使用精确 npm version。GitHub 包固定到默认分支的当前 commit SHA。目录提供的安装命令与仓库 URL 永远不会被执行或信任；可见 GitHub 链接根据经过校验的 owner 与 repository 名称重建。

Provider 请求具有部署可配置的条目数、字节数与时间限制。包变更串行执行，通过 subprocess 服务运行 `corepack pnpm`，使用有界收集输出、调用方拥有的 deadline 和该服务清理后的 environment。安装成功要求 dependency 以预期 package name 存在，并且已安装 manifest 声明 `dsh.bundle.patch`；校验失败会删除该 dependency。只有 pnpm 成功后才会修改 profile bundle 列表。每次成功变更都报告 `restartRequired: true`，因为运行中的 Loader graph 不会被热修改。

Settings 贡献是注册到 `settings.plugins.tab` 的独立 client plugin。它拥有数据源选择、提交式搜索、加载与失败状态、一个可见变更状态和重启提示。Remote callback 通过 slot injection face 进入；组件不会收到 Cordis context 或 Host service。

## 已考虑的替代方案

**在浏览器中获取目录并调用安装。** 不予采用，因为这会把 provider CORS 与 credential 暴露给页面，让不受信任的目录字符串获得本地执行路径，并绕过 profile 串行化与校验。

**添加市场专用包数据库与 loader。** 不予采用，因为 profile dependency、pnpm lockfile 与 bundle patch 已经拥有获取、版本、lifecycle script 与组合。第二个数据库会恢复两个安装权威。

**安装未固定 commit 的 GitHub 默认分支。** 不予采用，因为经过查看的目录条目与安装源码可能在解析和安装之间移动，而且重启后同一次操作可能产生不同包。

**热加载与热卸载市场包。** 不予采用，因为包安装会修改 dependency 并可能运行任意 setup，而删除 dependency 不能撤销当前进程中已经求值的代码。重启提供单一且明确的激活点。

**把市场状态合并进 Loader inventory 选项卡。** 不予采用，因为候选项与已安装 profile dependency 属于包状态，inventory 条目属于当前 Loader/Fiber 状态。分开的选项卡避免把安装呈现为激活。

## 验证

Host 测试固定 dsh.do 与 GitHub 过滤、安全仓库链接重建、包括多字节正文的精确响应字节限制、有界 wire 输入、固定 commit 的 Git spec、生成的 Remote 方法、成功与并发的 profile 调和、有界 subprocess 失败、删除调和，以及缺少 bundle 声明时的包回滚失败。Client 测试固定数据源变更、提交式搜索、刷新、安装/删除状态、通用失败收容、本地化 slot 注册和 disposer 行为。桌面 Host 测试证明所选 Node distribution 位于 PATH 首位，使打包 Corepack 可用。组装 Web 浏览器场景通过真实 profile 组合验证市场选项卡。

## 后果

- 插件市场不增加分发格式：CLI 与 GUI 安装都归并到 profile dependency 与 bundle patch。
- 外部响应与诊断保留在 Host 并受边界约束；页面只接收规范化条目与通用操作失败。
- GitHub 发现需要额外 manifest 请求，并受公开 API rate limit 约束；本包不增加持久目录 cache。
- 安装第三方包按设计会执行其代码。Bundle 声明检查可防止保留非 bundle dependency，但不构成代码安全审查。
- 在重启前，已安装与活动仍是不同状态，从而保留 Loader 生命周期权威。
