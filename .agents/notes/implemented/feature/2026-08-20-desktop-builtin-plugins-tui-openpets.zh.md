# Agent Note: 桌面内置插件、dsh tui 启动器与 OpenPets 伙伴应用

Status: implemented

[English](2026-08-20-desktop-builtin-plugins-tui-openpets.md) | 中文

## 问题

桌面发行版只携带工作区插件树：没有第三方插件随包，终端体验需要手动 profile + pnpm 安装，桌面宠物是固定的原生 Electron 窗口。产品请求要求四个树外插件内置进桌面包（dsh-TUI、dsh-web-ui、dsh-agent-teams、dsh-at-file）、为 dsh-TUI 提供一等终端入口，并以 OpenPets 伙伴应用作为桌面宠物。

## 决策

**内置插件以固定版本的 registry 依赖发货。** `scripts/desktop/stage-runtime.ts` 新增 `BUILTIN_PLUGINS` 列表，固定已发布版本的精确版本：`@deepseek-harness-tui/dsh-tui`、`@linxin666/dsh-web-ui-all`、`@nanmicoder/dsh-agent-teams` 与 `dsh-at-file`。运行时根 manifest 把它们合并到打包工作区 tarball 之前（冲突时 packed 优先），随包 `npm install` 从 registry 解析进 `resources/harness/node_modules`，安装后补丁再把它们写进已安装 `@deepseek-ai/dsh` manifest 的 `dependencies`，让 heal 的依赖闭包 BFS 在 `$DSH_HOME/profiles/node_modules` 下建立符号链接。任一内置缺失时 `verifyRuntime` 让暂存失败。桌面 web profile 默认启用：`PROFILE_TEMPLATES.web`（`packages/boot/app-boot/src/profile.ts`）在 web-app 层之后列出树外 bundle，新安装会在内置 web 栈之上播种 `dsh-web-ui-all`、`dsh-agent-teams` 与 `dsh-at-file`。`loadProfile` 只播种本安装可解析的模板层（源码检出丢弃树外行并停留在内置 web 栈），`normalizeShippedProfile` 仅在完整新模板都能从安装解析时，才把未改动的存量 profile（`INSTALLATION_OWNED_PROFILE_TUPLES.web`）升级到随附模板。市场的已安装状态跟随 `dsh.profile.bundles`，因此内置项显示为已安装并在每个 web 会话中生效。运行时 manifest 还固定 `BUILTIN_REACT_OVERRIDES`（`react`／`react-dom` 19.2.0）：dsh-tui 声明 react ^19.2.0，而 Web UI 插件带来 react ^18，若不覆盖，npm 会把 react 19 嵌套进 dsh-tui，同时被 hoist 的 `usehooks-ts` 解析到 react 18——reconciler 与组件对 hook dispatcher 的认知不一致，dsh-tui 崩溃并报 "Cannot read properties of null (reading 'useRef')"。dsh-tui 是 Node 运行时中唯一渲染 React 的消费者，因此该覆盖对整棵暂存树安全。

**`dsh tui` 是原生启动器，而非上游 bin。** 上游 dsh-TUI 启动器通过 `dsh plugin --profile dsh-tui add` 自举，这需要运行时里的 pnpm；随包运行时没有 pnpm。`apps/cli/src/tui.ts` 改为先 heal profile 模块，首次使用时为 `$DSH_HOME/profiles/dsh-tui` 播种 base + TUI bundle 层，证明 bundle 可解析（源码检出时 fail loud），再复刻上游参数语义：`--resume`／裸 `-c`／`--continue` 读取已记录目标（从 `.dsh-tui/resume.txt` 回退到 `.dsh-cc/resume.txt`）并同时写入 `DSH_TUI_RESUME_SESSION` 与 `DSH_CC_RESUME_SESSION`；一个 workspace 目标成为 `DSH_TUI_WORKSPACE_TARGET`；其余参数在 `dsh-tui` profile 下透传给 `runProfile`，并强制 `NODE_ENV ??= 'production'`。`args.ts` 路由 `tui` 子命令（透传选项，拒绝父级选项）。

**OpenPets 以原生回退替换宠物。** OpenPets 是独立 Electron 应用而非 dsh 插件，无法走插件管线。`stageOpenpets`（环境变量 `DSH_OPENPETS_SOURCE`）构建 OpenPets 工作区检出的桌面应用，并把解包产物复制到 `resources/openpets`；桌面壳层在存在时以 detached 方式启动 `openpets.exe` 作为宠物（`apps/desktop/src/openpets.ts`），应用缺失或无法构建时保留原生宠物窗口。暂存永远不会让桌面发行失败：回退说明取代应用。

## 备选方案

- **把插件作为 tarball 或 vendored 源码打包。** Registry 固定保持许可证与版本可审查，让 npm 解析传递依赖，并与现有 vendor manifest guard 一致，而不是增加第二条打包路径。
- **保持 Web 插件 opt-in。** 本 note 早期以“已安装未启用”发货以保持默认稳定；产品诉求把 dsh-web-ui 与 dsh-agent-teams 视为桌面体验的一部分，因此桌面 web profile 现默认启用（源码检出仍停留在内置 web 栈）。
- **spawn 上游 dsh-TUI bin。** 其基于 pnpm 的自举无法在无 pnpm 的随包运行时中运行；语义相同的原生启动器避免第二个包管理器，并把 resume／workspace 拦截保留在 harness 自有代码中。
- **把 OpenPets 做成插件。** 其发布包是没有 dsh bundle 入口的 Electron 应用；extraResources 接缝加原生宠物回退即可交付产品表层，而不必强加外来架构。

## 验证

stage-runtime specs 固定内置集合、packed 优先合并与 React 覆盖；tui specs 固定 resume 目标读取、两个环境变量名、workspace 目标拦截、透传与一次性 profile 播种；openpets specs 固定可执行文件解析与暂存跳过／复制；args specs 固定 `tui` 路由与父级选项拒绝。全量 host typecheck 与桌面单测通过；打包产物重跑暂存运行时验证与打包验收套件。

## 后果

桌面运行时更大（四个插件树加传递依赖），暂存需要打包时的 registry 访问。`dsh tui` 依赖随包 dsh-tui 包——源码检出会 fail loud 而不是降级。OpenPets 宠物是单向的：桌面壳层启动应用但不监管其窗口生命周期；原生宠物仍是开发与回退表层。web profile 默认启用 dsh-web-ui-all、dsh-agent-teams 与 dsh-at-file：桌面安装的每个 web 会话都带 Web UI 表层、agent 团队工具与文件工具；源码检出保持内置 web 栈。

## 相关

- [桌面包不再内置第三方插件](../simplification/2026-09-02-desktop-packages-ship-without-third-party-plugins.zh.md) 记录了当前实际发布状态：桌面包不再内置这些插件而接缝保持接线；上文所述 React 实例固定与 tui workspace 固定辅助函数已随其服务的 bundle 移除。
