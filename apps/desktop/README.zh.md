# @deepseek-ai/dsh-desktop

[English](README.md) | 中文

DeepSeek Harness 的私有 Electron 产品应用。Electron main process 持有单应用实例、沙箱化 BrowserWindow、导航策略和有界关闭。它使用标准 Node 可执行文件 fork 已构建的 `@deepseek-ai/dsh/desktop-host` 入口；子进程在已认证的动态回环 origin 上启动普通 Web profile，并保留现有 HTTP/WebSocket、插件、会话、终端、文件系统和子进程行为。

Renderer 启用 `contextIsolation` 和 Chromium sandbox，不具有 Node integration 或 preload API。导航前，Electron 安装通过私有 Node IPC 收到的逐进程 Host cookie。Host WebServer 在每项 HTTP route、静态 fallback、插件／HMR 资源和 WebSocket upgrade 前检查该 cookie；API Host／Origin 检查继续在下游执行。启动错误、Host 退出、协议违规和 renderer 终止会进入不具有 Node 权限的本地重试状态，并启动新的 Host generation。

无边框产品窗口会在每个 Host 文档或本地状态文档中安装紧凑的自定义 titlebar。Windows caption 控件使用 `Segoe Fluent Icons`，并回退到 `Segoe MDL2 Assets`。在 Host Web 布局中，现有可折叠 sidebar 贯通到窗口顶边，titlebar 从 sidebar 的实时宽度开始，内容表面则从其下方开始并带有左上圆角。Titlebar 的深浅色快捷切换使用 Web profile 的内置主题服务和 semantic token；桌面包不持有颜色皮肤。可分离透明桌面伙伴会在 Electron user data 下持久化可见性和位置，选择伙伴会恢复并聚焦 main window。桌面动作只以固定 `dsh-desktop:` window-open request 穿过 sandbox；main process 根据精确 allowlist 执行动作，并拒绝创建浏览器窗口。

NSIS 安装器把 `dsh.cmd` 放在桌面可执行文件旁，并把该目录注册到当前用户的 `PATH`。新终端可直接调用 `dsh`；wrapper 使用同一份随包标准 Node 和 production CLI 树，不启动 Electron。桌面进程与终端进程彼此独立，并共享普通 `DSH_HOME`。卸载只移除安装器自己的精确 PATH entry，并保留 Harness 数据。

## Development

在仓库根目录构建 Host 产物和 Web 前端，再启动桌面工作区：

```sh
pnpm run build
pnpm --filter @deepseek-ai/dsh-desktop start
```

开发模式依次使用 `DSH_DESKTOP_NODE`、`npm_node_execpath` 或 `node`，并从已构建的工作区包解析 `@deepseek-ai/dsh/desktop-host`。`DSH_DESKTOP_HOST_MODULE` 可替换 Host 入口，`DSH_DESKTOP_USER_DATA` 可为验收测试隔离 Electron 状态。生产模式忽略这些开发替换，并从 `resources/harness` 解析标准 Node 可执行文件和已安装 Harness 树；缺少资源会在 Host 启动前明确失败。

构建后，`pnpm run desktop:test:e2e` 会运行串行的源码模式 Electron 产品和生命周期验收测试。`pnpm run desktop:package:win` 会重新构建仓库、暂存经过校验的运行时、运行 Electron Builder，并写入 `SHA256SUMS.txt`。`pnpm run desktop:test:packaged` 会在 Windows 上验证解包产物、随包 Host、自定义壳层和 `dsh.cmd`。发行目标是交互式 NSIS 安装器和便携 zip；只有 NSIS 安装会注册 PATH。


## 第三方插件与桌面伙伴应用

打包运行时不再内置树外插件。dsh-TUI 终端界面（`@deepseek-harness-tui/dsh-tui`）、dsh-web-ui 插件包（`@linxin666/dsh-web-ui-all`）、dsh-agent-teams（`@nanmicoder/dsh-agent-teams`）与 dsh-at-file（`dsh-at-file`）等树外插件与任何第三方插件一样，经 Host 插件市场按需安装，并通过 `$DSH_HOME/profiles/node_modules` 的共享模块回退从任意 profile 解析。安装已发布的 `@deepseek-harness-tui/dsh-tui` 后，`dsh tui`（或 `dsh.cmd tui`）在终端启动 dsh-TUI profile；缺少该包时启动器直接失败并给出明确提示。Web 插件是 profile `cordis.patch.yml` 中的可选用行。

当 `DSH_OPENPETS_SOURCE` 指向 OpenPets 工作区检出时，运行时暂存阶段会把 OpenPets 伙伴应用一并打包：构建产物以 `resources/openpets/openpets.exe` 随包发布，桌面宠物开关改为启动它而不是原生伙伴窗口。未设置该变量，或 OpenPets 构建失败时，打包应用保留原生宠物窗口并写入诚实的回退说明。

## Model Experience

无。桌面包只监管和呈现现有 Web profile，不添加模型可见消息、工具、提示词段或提供方请求字段。

#### KV Cache effect

无；模型请求仍归已启动的 Harness profile 所有。

## Known Limitations and Deferred Work

- 解包 Windows 产物、随包 Host、自定义壳层和 CLI wrapper 已在构建机器通过打包验收。干净机器上的 NSIS 安装、PATH 传播、升级与卸载认证仍需要一次性 Windows runner。
- Windows x64 是唯一打包目标。macOS 签名／公证与 Linux 产物需要各自的原生依赖闭包和发行验证。
- 代码签名与 stable／beta 更新通道需要发布凭证和分发基础设施。未签名的开发产物不会进入生产更新通道。
