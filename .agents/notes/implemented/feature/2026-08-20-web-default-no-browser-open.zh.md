# Web 应用默认不再自动打开浏览器

[English](2026-08-20-web-default-no-browser-open.md) | 中文

## 决策

`dsh web` 应用现在只启动服务并打印 URL，不再自动打开默认浏览器；只有显式传入 `--open` 才会打开。`--no-open` 旗标已移除，配置默认值翻转为 `false`。桌面 Host 此前就传 `--no-open`，现在改为依赖随附默认值而不再显式指定。

## 背景

桌面产品体验（以及促成此工作的市场反馈）把启动时随机回环端口自动弹出的浏览器窗口视为噪音：桌面 Electron 壳自己加载带认证的 Host URL，而从快捷方式或命令行启动 Web GUI 也不应劫持用户浏览器。Web 应用的手动交接此前默认开启、以 `--no-open` 作为退出开关——这对一个服务端常常由脚本、SSH 客户端和编辑器启动的 harness 而言是错误默认。

## 备选方案

- 保留 `--no-open`，只教桌面入口传它。这会让其他所有 `dsh web` 调用者继续面对噪音默认，且没有修复根本默认值。
- 让 commander 报告选项来源以区分"未命名"与 `--no-open`。旗标反转更简单，也符合 pre-release 阶段"自由改名并同步所有引用"的立场。

## 影响

- `dsh web` 与 `dsh --profile web` 打印 URL 行，除非显式传入 `--open` 否则绝不打开浏览器；SSH 启动仍跳过交接并打印 URL。
- Web 应用配置默认值为 `openBrowser: false`；`web-startup` 把 commander 的 undefined 值归一化为 `false`。
- 调用方、测试、文档（CLI 参考、web-app README、根 README）、发布探针与浏览器打开快照全部跟随反转后的默认值；无 key 的翻译提示快照重新录制了 README 文本。
- 桌面 Host 的 `--no-open` 参数已移除；行为不变（Electron 加载认证 URL，绝不打开浏览器）。
