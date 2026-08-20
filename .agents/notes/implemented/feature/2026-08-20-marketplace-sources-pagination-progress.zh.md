# Agent Note: 插件市场第三方数据源、分页与安装进度

Status: implemented

[English](2026-08-20-marketplace-sources-pagination-progress.md) | 中文

## Problem

Host 侧插件市场（由 2fb925dfbc 拣选移植）只暴露 dsh.do bundle 目录与 GitHub 的 `dsh-plugin` topic，每次列表只返回一页，浏览器也无法看到安装过程的进展。产品需求新增三个第三方目录（dshplugin.io、dshmarket.com、dsh.deepseek404.com）、分页浏览与可视化安装进度条。

## Decision

`PluginMarketplaceSource` 联合类型扩展为五个：原有 `dsh` 与 `github` 提供方保持基于 API 的列表，新增 `dshplugin`、`dshmarket` 与 `dsh404` 抓取公开目录页。dshplugin.io adapter 读取站点 sitemap（插件 slug，对整表客户端分页）；dshmarket.com adapter 解析静态浏览页中的 owner/repository 卡片；dsh.deepseek404.com adapter 读取服务端 `?page=N` 页面（含类型与描述）。`PluginMarketplaceListRequest` 新增可选 `page`/`pageSize`；snapshot 携带请求的 `page`、派生的 `pages` 与总数；`pageSize` 被钳制到 `maxEntries` 配置上限。

三个第三方页面都不暴露版本、star 或 npm 身份，因此条目以中性元数据列出且 `installed: false`。变更操作惰性解析真实身份：dshplugin 抓取插件详情页，选择非站点自身仓库的 GitHub 链接；dshmarket 与 dsh404 直接使用 owner/repository id；三者随后从 raw.githubusercontent.com 抓取仓库 HEAD 的 `package.json`，获知 npm 包名并要求 `dsh.bundle.patch`。原有 `github` 与 `dsh` 解析路径不变。

网关新增 `progress` Remote。变更操作按 `resolve` → `install` → `activate` → `done` 报告阶段，带 0-100 百分比与包管理器输出尾部；`install` 百分比依据 pnpm 运行的耗时上升，同时以 500 ms 轮询转发其诊断。失败会在变更 reject 前报告 `failed` 阶段，`finally` 将状态重置为 `idle`。

Settings 选项卡渲染五个数据源按钮、基于 Host 派生日期的上一页/下一页分页控件，以及（变更运行期间）每 400 ms 轮询 `progress()` 的进度条，显示阶段、百分比、解析出的包名与输出尾部。安装与删除按钮在操作结束前保持禁用。

## Alternatives considered

- **依赖 dshmarket.com 宣传的 `dshmarket` npm 聚合包。** 其发布状态未经验证，而站点自身页面是稳定的公开契约，因此抓取保持提供方中立。
- **从 tarball 数量推导 pnpm 进度。** pnpm 的进度行跨版本不是稳定契约；确定性阶段区间加上真实输出尾部无需解析内部实现即可让进度条可信。
- **当第三方页面无法证明 npm 身份时放弃这些数据源。** 惰性变更解析让浏览仍然可用，并把安装作为验证身份的时点，这与既有 github/dsh 在变更时解析的模式一致。

## Verification

catalog 测试对各数据源的 XML/HTML 打桩，固定 slug/卡片解析、查询过滤、分页边界与页大小上限，以及包含缺失仓库与缺失 bundle 拒绝在内的变更解析。Gateway 测试固定发布的方法列表（含 `progress`）、分页透传，以及在受控 pnpm 运行中的 running → idle 进度生命周期。组件与 browser-plugin 客户端测试固定分页控件、禁用状态、带阶段/百分比/包名/详情的进度条，以及注入 progress callback 的失败路径。

## Consequences

第三方列表是对公开页面的抓取，元数据有限；安装时惰性解析真实包身份，因此链接仓库不可达的条目会以明确的 `failed` 阶段失败。所有新增提供方请求都遵守既有 `requestTimeoutMs` 与 `responseMaxBytes` 上限。没有 session、持久性或 API schema 变更：snapshot 只新增 `page`/`pages` 字段，并新增一个命名空间方法，浏览器通过既有生成 Remote 契约消费两者。
