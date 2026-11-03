# Windows 轻量模式快速部署

本模式保留 Windows 原生 DeepSeek Harness。两个 Linux 容器在**已有 Ubuntu WSL** 的网络中运行，容器自己发布 mDNS/DNS-SD；Windows 插件负责发现和连接。两个节点共享 Ubuntu 的地址、使用不同端口，共提供三项 mock API 服务。无需模型、GPU、新建 VM 或 Windows 代公告器。

实测可用的网络路径是独立运行在 Ubuntu 内的 Docker daemon。Docker Desktop 的 `host networking` 在本机只能打通普通 HTTP，未打通所需组播，因此这里不依赖该开关，也不自动修改它。

## 前提

- Windows 上安装 Node.js 24 或更新版本，以满足完整 Harness 插件运行要求。
- 已有 x86-64 Ubuntu WSL 发行版；当前脚本默认名称为 `Ubuntu`，可用 `-Distro` 指定已有发行版。
- 专用 daemon 使用项目缓存的 Docker static CLI，不依赖 `/usr/bin/docker` 或 Docker Desktop 的 WSL integration 挂载。缺少可用 Compose 时，启动脚本从 Docker 官方 GitHub 下载固定版本 `2.32.4`，核对 SHA-256 后只安装到项目忽略目录。
- 首次准备缺少的 npm 依赖、官方 Docker static archive 和 Compose 插件需要网络，或预先缓存这些文件。Release 部署包携带预构建镜像，无需准备 Node 基础镜像或本地构建；源码包需要已有本地 Docker 引擎导出 Node 基础镜像，或预先提供归档。

脚本不安装 WSL、不改变 WSL 网络模式、不修改防火墙、不重启 Docker Desktop，也不修改或重启 Harness。

## 检查和启动

从 GitHub Release 下载的**部署 ZIP**解压后，根目录包含 `release-manifest.json`，镜像位于 `images/`。保留完整目录结构，在解压目录的 PowerShell 中运行：

```powershell
.\scripts\doctor.ps1
.\scripts\start-demo.ps1 -DryRun
.\scripts\start-demo.ps1
```

启动器自动核对清单版本、镜像路径与 SHA-256，然后把压缩镜像加载进项目专用 Docker daemon，跳过基础镜像准备及源码构建，无需 Docker Desktop。缺少依赖时仍会执行 `npm ci --ignore-scripts`；缺少官方 Docker static 或 Compose 时仍需联网下载。因此部署包不等于完整离线安装包，也不包含 Windows Node.js、Ubuntu WSL 或 Harness。运行 `doctor` 前请先安装 Node.js 24+ 并准备已有 x86-64 Ubuntu WSL。

已识别的清单格式有误、镜像缺失或校验失败时会停止，不会自动回退为源码构建。`-DryRun` 与 `-WhatIf` 也会校验镜像，但不会加载镜像或启动容器。部署包始终按清单加载镜像，传入 `-SkipBuild` 不会跳过该校验。

**GitHub 自动提供的 Source code ZIP 或 Git clone**不包含预构建镜像，继续使用源码路线：

在仓库根目录的 PowerShell 中运行：

```powershell
npm ci --ignore-scripts
npm test
.\scripts\doctor.ps1
.\scripts\start-demo.ps1 -DryRun
.\scripts\start-demo.ps1
```

本仓库通过 `vendor/*.tgz` 使用版本化发现库、公告器和 Harness 插件；安装不依赖旁边的其他源码仓库。组件维护者的源码仓库与更新流程见 [仓库说明](repositories.md)。

若本机执行策略阻止脚本，可以仅对本次进程指定策略，不修改系统策略：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\start-demo.ps1
```

`doctor` 只读检查现有 Ubuntu 的架构与 `eth0` 地址，按网段匹配 Windows 对应的 `vEthernet` 地址，检查 Node、Compose、发行镜像或基础镜像，以及 runtime 完整性。`ReleaseBundlePresent: true` 和有效的 `ReleaseImage` 表示识别到部署包。`ComposeBootstrapRequired: true` 表示实际启动时需下载或启用项目缓存的插件；只读检查与 `-DryRun` 不下载。输出不会读取或打印 token 内容。它可能唤醒已经安装的 Ubuntu，但不会创建发行版。

`-DryRun` 和 `-WhatIf` 输出执行计划，不构建镜像、不生成凭证、不启动或停止容器。默认启动过程依次完成：

1. 缺少项目依赖时执行 `npm ci --ignore-scripts`。
2. 启动独立 daemon：`/var/tmp/llm-discovery-docker-0`。该 daemon 使用专用 socket、数据和日志目录，禁止 bridge、iptables/ip6tables、IP forwarding 和 masquerade 修改。
   Docker CLI 与 Compose 使用项目自己的配置目录 `spikes/network/.runtime/docker-cli`。若需要初始化 Compose，会先校验官方固定版本的 SHA-256；不修改用户 Docker 配置或系统 CLI 链接。
3. 部署包校验并加载清单指定的 `images/llm-discovery-demo-0.6.0.tar.gz`。源码路线优先使用隔离 daemon 中缓存的 `node:24-alpine`；其次加载 `spikes/network/.runtime/node-24-alpine.tar`。仅缺少缓存时，才从本机 Docker Desktop 导出基础镜像。
4. 复用 `.runtime/current` 中的 token、证书和客户端信任；第一次使用空目录时才初始化。
5. 部署包核对加载后的 `llm-discovery-demo:0.6.0` 镜像，不执行构建。源码路线执行 `scripts/prepare-offline-image.mjs`，在隔离 daemon 中以 `--pull=false` 构建同名镜像。
6. 生成该 runtime 的 Compose 挂载 override，只挂载 `server` 目录；启动 `llm-discovery-demo` 项目的两个节点，并只清理该项目中退役的 node-c 容器。
7. 从 Windows 进行 10 秒真实 mDNS 发现，检查三项服务，并保存 `discovery-latest.json`。

源码路线已有镜像且源码未改时可用：

```powershell
.\scripts\start-demo.ps1 -SkipBuild
```

`-SkipDiscoveryCheck` 仅用于诊断时跳过最后的发现检查。默认保留该检查；固定地址 HTTP 可达不能代替发现成功。

## 旧四服务目录迁移

先断开 LAN 并完全退出 Harness，再显式执行：

```powershell
node packages/lab-controller/cli.mjs migrate-three-state-demo --runtime .runtime/current
.\scripts\start-demo.ps1
```

保留原有私钥、证书、token、marker 和 runId，仅更新认证/拓扑并解除旧 tokenFile 引用；初始化不会隐式迁移。新版启动使用 `--remove-orphans`，只移除同一项目已经退役的 node-c。

随后按 [API key 三状态演示](api-key-demo.md) 点击展开 GLM 服务后保存一次 key，Vision 保持未配置，即可看到免 key、已保存和待输入三种状态。默认保存使用 Harness 的本地凭据 provider（当前是未加密 YAML）；可取消“记住 API key”而仅本次使用。

## Runtime、IP 变化与 Harness

默认 runtime 是 `.runtime/current`。重复启动会复用既有凭证。若 WSL 重启后 IP 改变，脚本会停止并说明地址不匹配，保留旧目录；选择新的目录显式创建新的一组信任数据：

```powershell
.\scripts\start-demo.ps1 -RuntimeDir .runtime/lan-20261102
```

非空目录缺少 `lab.json`，或者已有 runtime 缺少 token/证书时，也会停止，避免覆盖部分初始化状态。所有 runtime 都必须位于本仓库 `.runtime` 的子目录中。

新的 runtime 会产生新的 hostname、证书和 token。Harness 的插件安装和信任文件配置需按照 [插件安装说明](plugin-setup.md) 完成；这些脚本不会自动切换 Harness。使用启动命令打印出的 `client/trust.json` 路径，不能把上一组凭证仅凭相同服务显示名转移到新服务。

安装插件前完全退出 Harness，再使用当前安装版自带 CLI 安装本仓库的插件包。将以下应用路径替换为自己的 Harness 安装位置，在 Demo 根目录运行：

```powershell
& 'C:\path\to\DeepseekHarness\resources\runtime\cli\bin\dsh.cmd' plugin --profile desktop add (Join-Path $PWD 'vendor/dsh-lan-discovery-0.5.0.tgz')
```

这会安装打包版本，日常运行不需要保留插件源码 checkout。配置、升级和断开恢复步骤见插件安装说明。独立插件默认关闭演示行为；本 Demo 需按说明显式设置 `demoMode: true`，启用固定 marker 工具和 Mock 上下文标注。插件界面优先跟随 Harness 语言偏好，没有偏好时按系统语言选择，支持中文与英语。

## 停止与保留状态

```powershell
.\scripts\stop-demo.ps1 -DryRun
.\scripts\stop-demo.ps1
```

若启动时指定了其他 runtime，停止时传入相同参数：

```powershell
.\scripts\stop-demo.ps1 -RuntimeDir .runtime/lan-20261102
```

停止脚本仅对专用 socket 上的 `llm-discovery-demo` Compose 项目执行 `down`。它保留 daemon、镜像、runtime 和 Harness 状态；其他容器和引擎不受操作。

需要关闭或删除隔离 daemon 时，先停止完整 demo，再按 `spikes/network/README.md` 使用 `wsl-engine.sh stop` 或 `cleanup`。不要对整个 WSL 执行 shutdown 来清理此 demo。

## 排查

- **Release 镜像丢失或 SHA-256 不匹配：**重新下载并完整解压部署 ZIP，保留 `release-manifest.json` 与 `images/` 目录。不要删除清单来绕过校验；需要自行构建时另取源码包。
- **Desktop 显示不可用，但隔离 daemon 已有基础镜像：**可继续离线启动；Desktop 不参与正式镜像构建。
- **缺少基础镜像且 Desktop 无法导出：**在其他可信 Docker 环境导出 `node:24-alpine`，放到 `spikes/network/.runtime/node-24-alpine.tar` 后重试。
- **找不到对应 vEthernet：**查看 `doctor` 输出，核对指定的是现有 Ubuntu 发行版及其实际接口。不要改用静态服务清单替代发现。
- **容器启动后发现不足三项：**保留运行现场，查看 runtime 的发现快照和两个节点日志。脚本不会通过 Windows 代公告器绕过问题。
- **首次镜像准备与重复启动的区别：**基础镜像、Node 依赖和官方 static archive 需要一次性缓存；`--pull=false` 的正式构建不要求访问 registry。

网络 spike 的原始记录和实际验证边界见 `docs/network-spike.md`。

## 独立实现的互操作观察（可选）

正式节点全部在线时，可以用与项目 Node 发现库独立的 `python-zeroconf` 验证 DNS-SD。观察器只查询和解析，不公告服务、不发送推理请求、不读取 Harness 凭证。以下命令将依赖安装在仓库内的隔离虚拟环境：

```powershell
python -m venv spikes/network/.runtime/interop-venv
& .\spikes\network\.runtime\interop-venv\Scripts\python.exe -m pip install zeroconf==0.153.0
& .\spikes\network\.runtime\interop-venv\Scripts\python.exe spikes/network/interop-observer.py --interface <doctor输出的WindowsInterfaceAddress> --seconds 20 --expected 3 --output artifacts/interop.json
```

### 历史四服务版本的实测记录（2026-11-02）

以下记录对应旧三容器、四服务版本，不作为 0.4.0 三服务或凭据持久化的验收。

2026-11-02 已实测解析四项服务。`artifacts/interop.json` 保留标准 TXT 字段、端口与观察结果，移除实际 IP、hostname、本地路径和服务实例名；它证明 DNS-SD 的独立实现互通，不代替 TLS、授权、Harness 或生命周期验收。

本机另已实际执行默认 `start-demo.ps1`：复用了已有 runtime、离线构建并启动三个节点，最后 Windows 发现检查为 4/4。随后实际执行 `stop-demo.ps1`，再运行 `start-demo.ps1 -SkipBuild` 恢复；本项目运行容器数为 3→0→3，恢复后发现 4/4 服务。11 个 runtime token、CA、证书、密钥和信任配置文件的 SHA-256 比较全部一致，哈希值和文件内容未写入报告。脱敏时间和结果见 `artifacts/start-stop.json`。

本次网络调查临时启用过 Docker Desktop 的 `Enable host networking` 开关，现已通过官方 UI 取消勾选并执行 Apply & restart，恢复为关闭。2026-11-02 16:54（香港时间）的只读复核确认：独立 WSL daemon 的三个节点仍持续运行，Windows 在 8 秒观察中发现并验证四项服务。复核没有启动、停止或重建容器，证明当前路线不依赖该全局开关。启动与停止脚本也不调整这一设置。
