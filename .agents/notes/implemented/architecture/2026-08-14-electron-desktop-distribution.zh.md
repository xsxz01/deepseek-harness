# Agent Note: 使用受监管 Harness Host 的 Electron 桌面发行

Status: implemented

[English](2026-08-14-electron-desktop-distribution.md) | 中文

## Problem

DeepSeek Harness 需要可安装的桌面应用，在不要求用户安装系统 Node.js 或 pnpm 的前提下，保留现有 React/Vite 客户端、Cordis 插件组合、HTTP/WebSocket 协议、文件系统访问、子进程与终端行为、持久化 Harness home 和 CLI 互操作。

Web profile 不是静态 renderer。它会动态加载包和用户插件、注入 `window.__DSH_BOOT__`、持有 HTTP 与 WebSocket 连接、通过 `node-pty` 启动进程树，并加载 `sharp` 和 `koffi` 等原生依赖。若以第二套桌面传输或后端替换这些机制，就会重复生产行为并分裂验证权威。

[GUI 分层与 RPC 协议](2026-07-19-gui-layering-and-rpc-protocol.md)最初为 Electron IPC 载体预留位置。桌面产品需要确定具体载体，同时不改变 Host/Client 拆分、RPC 消息、浏览器载体或普通 `dsh web` 行为。

## Decision

`apps/desktop` 是不包含第二套 renderer 的 Electron main-process 应用。它在独立标准 Node.js 进程中监管现有 Web profile，并让沙箱化 `BrowserWindow` 加载该 Host 的已认证回环 origin。首个受支持产物为 Windows x64。

Electron 持有单实例锁、窗口状态、导航策略、Host 生命周期、重试呈现和应用关闭。它绝不把 Harness 组合导入 Electron 进程。Host 继续使用仓库的标准 Node ABI，因此 Host 崩溃、原生模块和动态安装的 Node 插件不会共享 Electron ABI 或生命周期。

NSIS 安装器把根目录 `dsh.cmd` 注册到当前用户 PATH。该 wrapper 使用随包标准 Node 启动 CLI，而不启动 Electron，因此终端进程和桌面进程彼此独立，同时使用同一个默认 `DSH_HOME`。卸载会移除自己的精确 PATH entry，但不会删除 Harness 数据。Electron 应用不为 Harness 持有的持久格式建立迁移路径或私有副本。

### Process and protocol ownership

`@deepseek-ai/dsh/desktop-host` 在 `127.0.0.1` 动态端口启动 Web profile。Electron 通过随包 Node 24 fork 它，并在就绪前立即取得子进程所有权。私有 Node IPC 协议传递 `ready`、`fatal` 和 `stopping` 事件；stdout 与 stderr 只承载诊断，绝不用于解析就绪状态。

Ready 事件携带 origin、HttpOnly cookie 名称和值、Host PID 与 Harness 版本。Host 在私有进程内存中持有 token；它只通过私有 IPC 传给 Electron，并且只以 HttpOnly session cookie 形式进入 renderer 进程。WebServer 在 index、API route、静态与插件资源、HMR 资源和 WebSocket upgrade 之前都要求该 cookie；现有 Host 与 Origin 检查继续在下游执行。

Host 启动、正常关闭和强制进程树终止分别具有独立时限。格式错误或重复 IPC、提前退出、意外退出和 renderer 终止都会进入受 CSP 限制的本地失败文档。重试创建新的 Host generation，generation 检查阻止陈旧就绪或终止事件修改当前状态。应用关闭会使待处理呈现失效，并且只等待所持有的 Host，因为窗口关闭时 renderer 导航可能永不结算。

### Electron security rules

生产窗口使用 `contextIsolation: true`、`nodeIntegration: false` 与 `sandbox: true`，且没有 preload API。窗口内只允许当前已认证 Harness origin 导航；拒绝其他回环 origin、`file:`、popup、下载和权限请求。非回环 HTTP(S) 链接可以在系统浏览器中打开。Renderer 失败不会向本地重试文档授予脚本权限。

窗口 bounds 与最大化状态以原子方式存储在 Electron user data 下，作为持久 JSON 严格校验，并限制到当前 display。移除或调整 monitor 后不会恢复出不可访问的窗口。

### Desktop product shell

Main window 无边框，并在每个已认证 Host 文档和本地生命周期文档中安装紧凑的桌面专用 titlebar。Caption 控件使用 Windows `Segoe Fluent Icons` glyph，并回退到 `Segoe MDL2 Assets`。在 Web 布局中，ResizeObserver 会在现有 sidebar 折叠或调整宽度时保持 titlebar 左边缘与该栏对齐；sidebar 贯通到窗口顶边，center 和 details column 从 titlebar 下方开始，center surface 持有左上圆角。Titlebar 不包含重复产品品牌。

Renderer 不接收通用 Electron bridge。窗口和宠物控件通过被拒绝的 window-open request 发出固定 `dsh-desktop:` target；main process 只执行精确动作。不具有特权的主题按钮会分派 `dsh-desktop:theme-toggle`，现有 Web ThemeRuntime 则通过 Host-backed settings 路径把已解析配色转换为明确的内置 `light` 或 `dark` 偏好。桌面代码不定义 palette，也不持久化颜色偏好。可分离桌面伙伴是一个独立透明、沙箱化、always-on-top 的 BrowserWindow，使用带 CSP 的本地文档和嵌入产品资源。可见性和限制到 display 的位置持久化在 Electron user data 下；选择伙伴会恢复并聚焦 main window；关闭 main window 会在 Host 关闭前销毁伙伴。

### Runtime and packaging closure

`scripts/desktop/stage-runtime.ts` 构建生产 tarball、安装不含 workspace link 的依赖闭包、下载经 checksum 校验的 Node 24.19.0 Windows x64 运行时，并使用该 Node 探测 `node-pty`、`sharp`、`koffi` 与 `esbuild`。Staged release 记录目标、Electron、Node 与 Harness 版本、Node checksum、每个 workspace package、每个已安装名称／版本／许可证组合以及第三方许可证索引。

Electron Builder 将 main bundle 放入 ASAR，并把 Node 与显式生产 `node_modules` 树复制到 `resources/harness`。它不会按 Electron ABI rebuild Host 原生模块。固定的 pnpm patch 使 Electron Builder 26.15.3 能兼容其声明的 `@electron/get` 依赖提供的 cache API。Builder 使用已经安装并校验 checksum 的 Electron distribution，不下载第二份副本。

Windows 构建生成交互式按用户 NSIS 安装器、便携 zip、解包诊断树和 blockmap。安装器通过幂等 helper 把自身目录加入用户 PATH 并广播环境变化；卸载只移除归一化后精确匹配的 entry。便携 zip 包含 `dsh.cmd`，但不修改 PATH。卸载默认保留 `DSH_HOME` 与 Electron user data。

### Verification

Focused unit test 固定导航拒绝、持久窗口与伙伴偏好恢复、桌面动作解析、内置主题快捷键生命周期、宠物位置、CLI PATH 归一化、协议解析、立即 Host 所有权、启动与关闭时限、generation 竞态、renderer 失败、重试文档和运行时路径选择。真实 Electron 43 测试通过 CDP 连接，并验证 HttpOnly cookie、renderer 中不存在 `require`、Windows caption font、移除重复品牌、最大化／还原、伙伴创建与隐藏、Host 崩溃／重试、renderer 崩溃／重试、自定义 titlebar 关闭以及干净进程退出。

打包验收测试启动 `win-unpacked/DeepSeek Harness.exe`，调用根目录 `dsh.cmd`，等待随包 Host 的回环 UI，检查自定义壳层、已认证 HTTP 与 renderer 隔离，观察恰好一个标准 Node Host 子进程，通过 titlebar 关闭窗口，并验证 Electron 与 Host PID 都退出。Staging smoke 与 packaged smoke 使用发行资源，而不是 workspace import。

## Alternatives considered

**Tauri 2 加 Node sidecar。** Tauri 会减小 shell 体积，但仍需分发 Node 与完整 Harness 依赖树。它会增加 Rust、系统 WebView 差异、sidecar 权限和另一套跨平台资源模型，却不会移除占主要体积的后端负载。

**Electron IPC fetch 加 `file:` renderer。** 这需要为 fetch、WebSocket 下行、动态插件资源、`__DSH_BOOT__`、认证和浏览器相对 URL 建立第二套实现。复用已认证 Web origin 可保留一套生产载体和现有浏览器验证。

**在 Electron main 或 utility process 中运行 Harness。** 这会把 Host 故障、原生模块和用户插件耦合到 Electron 的 Node ABI 与生命周期。受监管的标准 Node 进程保留受支持 Host 环境，并给 Electron 明确的进程树所有权边界。

**要求系统 Node.js。** 这会让启动依赖 PATH、engine 版本、原生模块安装和 package manager 状态。可安装桌面产品必须自包含。

**打包 workspace `node_modules`。** Workspace link、开发依赖、陈旧输出和宿主平台 binary 会进入产物。安装生产 tarball 才能证明实际 release closure。

**立即构建所有操作系统。** 在进程模型得到证明前成倍增加原生模块、签名、updater、shell 和 installer 变量会掩盖失败。Windows x64 是当前唯一支持声明。

**原生 titlebar overlay。** Electron 原生 overlay 保留平台 caption button，但无法跟随 Web sidebar 的实时宽度，也无法提供相同的本地生命周期呈现。无边框窗口把现有 sidebar 与紧凑拖拽区连接起来，glyph font 则保留 Windows caption 图标体系。

**为桌面控件提供通用 preload IPC。** Preload bridge 会为封闭 command set 增加 privileged renderer API 和 IPC contract。精确且被拒绝的 window-open target 保留 no-preload 安全规则，并且不能携带任意 method 或 payload。

**在 main page 内渲染伙伴。** 页面内 mascot 无法出现在产品窗口外，并且会共享 Host renderer 故障。独立沙箱窗口可在 main window 最小化时继续可见，同时仍随持有它的 desktop shell 一起销毁。

## Consequences

Electron 加标准 Node 会增加产物体积，但保留一个客户端和一种 Host 传输。每个未来目标仍需要独立 staged 原生依赖闭包和 packaged acceptance。

PATH 注册让随包 CLI 无需第二次安装即可供新终端使用，但安装过程会修改一项用户环境值，并且只能移除自身归一化后的 entry。共享 `DSH_HOME` 可立即获得 CLI 互操作，也会共享并发与持久格式风险。现有 package 级 locking 和 schema 所有权继续作为权威；桌面代码不得增加竞争性的迁移机制。

自定义壳层增加一个注入式 presentation layer，但不向 renderer 授权。启用伙伴会增加第二个沙箱化 renderer 和 always-on-top window；其生命周期和持久位置继续由 main desktop window 持有。

强制关闭可能中断活动 model、tool、PTY 或持久化工作。应用先尝试正常完全停稳，再执行有界进程树终止；持久恢复仍由持有数据的 package 负责。

生产代码签名、stable／beta 更新通道、更新凭证、macOS notarization、Linux packaging 和干净机器发行认证属于延后的 release infrastructure。未签名工程产物不会发布到生产更新通道。本笔记中的进程、认证、ABI 和 packaging 决策继续约束这些工作。
