# Agent Note: 桌面窗口通过 Host token 交换完成认证

Status: implemented

[English](2026-08-28-desktop-browser-token-exchange.md) | 中文

## 问题

合并上游 master（dsh-0.1.2-alpha.1）后，打包版桌面显示 "dsh web authentication required"
页面而非 Web UI。合并后的 Web 运行时用上游 BrowserAuth 流程认证首页
（packages/client/connection/src/browser-auth.ts）：客户端加载 `/?token=<进程启动 token>`，
服务端以 303 返回签名的 `dsh-auth-*` cookie，重定向携带该 cookie。
fork 的桌面 Host 仍走合并前流程：自造随机 token 注册为 WebServer 启动认证，
并让 Electron 在加载 origin 前预置 `dsh-desktop-host` cookie。该流程有两处失效：
WebServer 启动认证不再绑定到合并后 bundle 的 root；Chromium 也不发送首次导航前
通过 `session.cookies.set` 安装的 cookie，因此 fork cookie 永远到不了服务端。

## 决策

桌面 Host 端到端采用上游交换流程。

- `apps/cli/src/desktop-host-protocol.ts`：ready 事件改为携带认证 URL（`url`）而非预置
  cookie；解析器校验仅含一个 43 字符 `token` 查询参数的 loopback URL。
- `apps/cli/src/desktop-host.ts`：移除 `provideWebServerAuthentication`，改向
  `connection` 服务取 `authenticatedUrl(origin)`。
- `apps/desktop/src/window.ts`：加载 `ready.url`；服务端 303 Set-Cookie 成为唯一的
  cookie 安装路径。
- 桌面 fixtures 与 e2e 断言随之改为交换流程（cookie 名前缀 `dsh-auth-`、SameSite Strict、
  HttpOnly）。
- `desktop:package:win` 前置 `tsc -b apps/desktop/tsconfig.json`：桌面包为 private 且不在
  tsconfig.host.json 引用内，官方构建从不刷新其 `lib/types`，导致任何 `apps/desktop/src`
  ​​改动后 tsdown 都会把过期的桌面模块打进 `lib/main.js`。

## 影响

桌面窗口与浏览器中的 `dsh web` 执行相同的认证交换。fork 的 `dsh-desktop-host` cookie
及其 Electron 预置路径已移除；WebServer 启动认证能力仍保留导出供其他调用方使用。
打包现在自洽：改动 `apps/desktop/src` 不再会让安装包悄悄带上过期的 renderer main。
