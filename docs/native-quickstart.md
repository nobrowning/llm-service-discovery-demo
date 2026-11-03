# macOS、Linux 与 Windows 原生启动

本路线从公开 Release 0.6.1 起提供。两个本机 Node.js 子进程各自提供 Mock HTTPS API 和 mDNS 公告，共三项服务；需要 Node.js 24+，无需 Docker、WSL 或模型。macOS Apple Silicon/Intel、Linux arm64/x64 使用对应架构的 Node；Windows x64 同样使用此入口。实际覆盖见 [验证报告](validation-report.md)，支持的 Harness Host 与服务端运行平台分开判断。

## 下载与校验

从 [Releases](https://github.com/nobrowning/llm-service-discovery-demo/releases/latest) 下载 `llm-service-discovery-demo-0.6.2-native.zip` 和同页 `SHA256SUMS`。先核对 ZIP 的 SHA-256：macOS 使用 `shasum -a 256 文件.zip`，Linux 使用 `sha256sum 文件.zip`，Windows PowerShell 使用 `Get-FileHash 文件.zip -Algorithm SHA256`。核对值来自同次 Release。

解压后进入目录。ZIP 已含 JavaScript 依赖和组件 tgz，不包含 Node.js、Harness 或运行凭据。GitHub 自动生成的 Source code 包则需要先执行 `npm ci --ignore-scripts`；源码没有发行清单，跳过下方的 `verify-release-files.mjs`（该命令仅用于部署 ZIP），其他指令相同。

```sh
node --version
node scripts/verify-release-files.mjs
node scripts/verify-components.mjs
node packages/lab-controller/cli.mjs --help
node packages/lab-controller/cli.mjs list-interfaces
```

最后一条列出本机非回环 IPv4。选择与客户端处在同一局域网的地址；VPN、Docker 或 WSL 虚拟网卡地址不一定可被另一台电脑访问。接口只有一个时可自动选择，多个接口时必须明确指定。下文 `192.168.1.10` 是例子，替换为自己的地址。

## 启动、检查、停止

```sh
node packages/lab-controller/cli.mjs native run --runtime .runtime/native --interface 192.168.1.10
```

这是前台进程；保持终端开启，等待就绪输出。`native start` 是同义命令。`--address` 默认等于选择的网卡地址，只能指定本机 IPv4。默认 API 端口为 18443、28443；第一次生成独立实验 CA、证书和合成 API key，不修改系统证书库。重复启动保留已有凭据。IP 改变或目录不完整时，选择新的 runtime，保留旧目录供检查。

另开终端，进入同一目录：

```sh
node packages/lab-controller/cli.mjs native status --runtime .runtime/native
node scripts/verify-live.mjs --runtime .runtime/native
node scripts/verify-lifecycle.mjs --backend native --runtime .runtime/native
```

`verify-live` 使用真实 mDNS、插件 TLS 信任和 Responses adapter，检查文本、图像、流式响应、认证及工具往返；它会读取本实验生成的服务端测试 key，不是 Harness 界面验收。生命周期检查临时撤销 A 的文本服务再恢复，期望 3→2→3。接入 Harness 或另一台客户端时保持服务终端运行。

使用结束后执行 `node packages/lab-controller/cli.mjs native stop --runtime .runtime/native`，或在前台按 Ctrl+C，撤销公告并停止本次两个子进程；凭据保留。控制通道仅监听回环地址，随机凭据保存在 runtime 中，不通过任意 PID 结束进程。

## 另一台电脑作为客户端

服务端保持上面的进程运行。经可信通道把 runtime 的 `client/` 目录交给客户端，插件 `trustFile` 使用该目录中 `trust.json` 的绝对路径，`interfaceAddress` 使用**客户端自己**的局域网 IPv4。该实验信任包含服务端固定地址和证书指纹；地址改变后重新生成并传递信任。不要把服务端 `server/` 私钥目录分发给普通客户端。

Mac/Windows Desktop 的插件安装见 [插件说明](plugin-setup.md)。Linux 先验证 CLI/网络功能；Harness Web Host 的完整 UI、生命周期与凭据行为须单独验收，不能把不存在的官方 Linux Desktop 安装步骤写成已支持。

## 网络排查

- 同一子网，放通应用所需的 UDP 5353 组播与 TCP 18443/28443。macOS 的本地网络权限提示和应用防火墙由用户在系统设置中处理；不需要关闭系统防火墙。
- Bonjour/Avahi 通常已占用 5353；实现使用共享 UDP 绑定。应观察是否实际收到公告，不要先停掉系统服务。`EADDRINUSE`、`EACCES`、`EADDRNOTAVAIL` 保留错误并检查接口和权限。
- Wi-Fi 访客隔离、组播过滤、跨 VLAN、VPN 和虚拟机 NAT 可能阻止发现。IP 直连成功不能替代 mDNS 验证。
- 在 Unix 配置文件中使用真实绝对路径，例如 `/Users/alice/demo/...` 或 `/home/alice/demo/...`；插件配置不展开 `~`、`$HOME`。含空格的终端路径用引号包围。
- 脚本没有删除隔离属性或关闭 Gatekeeper 的步骤；如有系统提示，先确认来自选定 Release 且校验值一致，再按系统提示处理。

## Linux Docker Engine（可选源码路线）

原生 Node 路线优先。要在 Linux Engine 中使用两个容器，先在目标 Linux 本机安装 Docker/Compose 和 Node，执行 `npm ci --ignore-scripts`，再运行：

```sh
export DEMO_INTERFACE=192.168.1.10
export DEMO_UID="$(id -u)" DEMO_GID="$(id -g)"
node packages/lab-controller/cli.mjs init --address "$DEMO_INTERFACE" --interface "$DEMO_INTERFACE" --runtime .runtime/linux
export DEMO_SERVER_DIR="$PWD/.runtime/linux/server"
docker compose -f deploy/compose.yaml -f deploy/compose.linux.yaml up --build -d
node scripts/verify-live.mjs --runtime .runtime/linux
docker compose -f deploy/compose.yaml -f deploy/compose.linux.yaml down
```

overlay 使用宿主用户的 UID/GID，保留私钥和 token 的 0600 权限，避免默认容器 UID 1000 无法读取其他用户创建的文件。host network 不隔离服务端口。此处从源码构建本机架构镜像；Windows/WSL ZIP 中预构建镜像仅为 linux/amd64，不是多架构镜像。Docker Desktop 的 VM/host networking 与 Linux Engine 不同，不能据此承诺 Mac Docker 的 mDNS 可用。
