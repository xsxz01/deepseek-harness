# Agent Note: 桌面包不再内置第三方插件

Status: implemented

[English](2026-09-02-desktop-packages-ship-without-third-party-plugins.md) | 中文

## 问题

桌面产品曾把四个树外插件——`@deepseek-harness-tui/dsh-tui`、`@linxin666/dsh-web-ui-all`、`@nanmicoder/dsh-agent-teams` 与 `dsh-at-file`——作为 `BUILTIN_PLUGINS`（`scripts/desktop/stage-runtime.ts`）固定的 registry 内置依赖随包发布。把第三方代码打进每一个发布产物会带来一项常设义务——固定版本、许可证、传递与 peer 依赖解析——在内置机制尚未稳定时不值得承担，而且会让每个桌面版本都携带项目并不拥有的代码。

## 决策

桌面包不再内置第三方插件。`BUILTIN_PLUGINS` 默认是空列表，但其周边的接缝保持接线：`runtimeDependencies` 仍把 registry spec 合并进运行时 manifest，`addBuiltinDependencies` 仍把它们写进已安装 CLI manifest 供 profile heal 闭包使用，`verifyRuntime` 在所列内置缺失时仍让暂存失败。后续发布只需恢复固定条目即可重新启用内置。仅为 dsh-tui 服务的 React 实例固定（`BUILTIN_REACT_OVERRIDES`）以及 tui 的 workspace 固定与去重辅助函数随其所服务的 bundle 一并移除。`PROFILE_TEMPLATES.web`（`packages/boot/app-boot/src/profile.ts`）仍在 web-app 层之后列出树外 bundle，但 `loadProfile` 只播种本安装可解析的模板层，因此没有这些插件的运行时停留在内置 web 栈上。安装已发布的 `@deepseek-harness-tui/dsh-tui` 后，`dsh tui` 启动 dsh-TUI profile；缺少该包时直接失败并给出明确提示。

## 备选方案

- **保留仅测试构建跳过的内置开关。** 之前的 `DSH_DESKTOP_SKIP_BUILTINS=1` 门只在测试构建中清空列表，生产包仍然内置插件。在稳定化等待期间每次发布都背负该义务，正是要推迟的事。
- **彻底移除内置接缝。** 在保留 `runtimeDependencies`／`addBuiltinDependencies`／`verifyRuntime` 接线的同时清空列表，保住了后续启用路径与其暂存期验证；删除它们会在机制稳定时迫使重写，并丢弃已被测试的接缝。

## 后果

- 桌面产物不再包含第三方 npm 包；打包树的许可证与传递解析收窄到工作区及其一方依赖。
- dsh-TUI 终端、web UI 插件包、dsh-agent-teams 与 dsh-at-file 改为按需安装（Host 插件市场、profile `cordis.patch.yml` 行）而非预装。
- 后续重新启用内置只是一处数据改动（恢复 `BUILTIN_PLUGINS` 的固定条目）；若 TUI bundle 回归，还需恢复 dsh-tui 的 React 处理。

## 相关

- [桌面内置插件与 OpenPets 伙伴应用](../feature/2026-08-20-desktop-builtin-plugins-tui-openpets.zh.md) 记录了本注记暂停的机制，并保留了幸存接缝的论证。
