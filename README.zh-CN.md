# 局域网 LLM API 服务发现 Demo

[English](README.md) · [验证报告](docs/validation-report.md) · [协议映射](docs/protocol-mapping.md)

在 DeepSeek Harness 内发现局域网 LLM API，检查服务后接入正常会话。对应 [IETF 草案 -00](https://datatracker.ietf.org/doc/draft-cui-dawn-local-llm-api-discovery/) 的实现实验。

两个节点各自发布 mDNS/DNS-SD，共提供 DeepSeek 文本、Qwen 图像、GLM 工具调用三项 Mock API。网络发现、HTTPS、认证、SSE、图片字节传输和工具结果回传真实执行；推理为模拟，无需模型、GPU 或云 key。[模型展示说明](docs/model-presentation.md)中的名称不代表实际加载了权重。

## 下载运行

在 [GitHub Releases](https://github.com/nobrowning/llm-service-discovery-demo/releases/latest) 选择附件，与同页 `SHA256SUMS` 核对 SHA-256 后解压。

| 运行方式 | 附件 | 前提 |
|---|---|---|
| macOS、Linux、Windows 原生进程 | `llm-service-discovery-demo-0.6.2-native.zip` | 对应系统/架构的 Node.js 24+ |
| Windows 客户端 + 两个 Linux 容器 | `llm-service-discovery-demo-0.6.2-windows-x64-wsl.zip` | Windows x64、Node.js 24+、已有 x64 Ubuntu WSL |

两个 ZIP 均带 JavaScript 依赖和插件 tgz；只有 WSL 包带预构建 linux/amd64 镜像。Node.js 与 Harness 需另行安装。GitHub 自动提供的 Source code 包需要先执行 `npm ci --ignore-scripts`。

原生包解压后，在目录中运行：

```sh
node scripts/verify-release-files.mjs
node packages/lab-controller/cli.mjs list-interfaces
node packages/lab-controller/cli.mjs native run --runtime .runtime/native --interface YOUR_LAN_IPV4
```

将 `YOUR_LAN_IPV4` 替换为列表中的本机局域网 IPv4。保持前台终端开启，在另一终端进入相同的解压目录执行：

```sh
node scripts/verify-live.mjs --runtime .runtime/native
node scripts/verify-lifecycle.mjs --backend native --runtime .runtime/native
```

接入 Harness 时保持服务终端运行。使用结束后执行 `node packages/lab-controller/cli.mjs native stop --runtime .runtime/native`，或在服务终端按 Ctrl+C 停止。

网卡选择、跨设备信任、权限和 Linux Docker 可选路线见 [原生部署](docs/native-quickstart.md)。Mac 用户可按 [Desktop 指南](docs/mac-desktop-quickstart.md)安装插件并检查会话，远程测试见 [SSH 连接](docs/mac-ssh-validation.md)。首次在本机生成实验 CA、证书和合成 key，重启保留，不修改系统证书库。

WSL 包在 Windows PowerShell 中运行：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\start-demo.ps1
```

脚本校验并载入镜像，缺少 Docker static/Compose 时首次需联网。详见 [Windows 部署](docs/windows-quickstart.md)；停止使用 `scripts/stop-demo.ps1`。两个容器共享 WSL 地址，以端口和路径区分。本路线不能证明 Docker Desktop 的组播可用。

## 接入 Harness

使用已安装 Harness 自带的 CLI 安装 `vendor/dsh-lan-discovery-0.5.2.tgz`，配置实验信任文件与**客户端本机**网卡。具体见 [插件安装](docs/plugin-setup.md)。Host 兼容版本固定为 **0.2.1-rc.3 / rc.5**；Windows/macOS Desktop、Linux Web Host 评估、服务端独立运行分别验收，实际状态见验证报告。

打开“局域网服务 / LAN services”，点击一行展开检查、连接与 key 操作。选中不自动连接，收起或切换清除未提交密码。中英文跟随 Harness 语言偏好。发现记录本身不授权向未知服务发送凭据。

**三种认证状态：** DeepSeek 无需 key；首次手动保存 GLM 的合成 key；Qwen-VL 保持待输入。实验 key 位于所选 runtime 的 `presenter/demo-api-keys.txt`，步骤见 [API key 演示](docs/api-key-demo.md)。插件使用 Harness 凭据服务，当前默认 provider 为本地未加密 YAML，不等同于系统 Keychain/secret service。无需真实云服务凭据。

免 key Open Responses 服务是明确实验扩展：草案 -00 要求 `auth=required`。两种方式都校验独立 TLS 信任。

## 开发与验证

```sh
npm ci --ignore-scripts
npm test
node scripts/verify-components.mjs
node packages/lab-controller/cli.mjs --help
```

CI 配置 Windows x64、Linux x64/arm64、macOS x64/arm64 与 Node 24。纯 JavaScript 包无需按系统编译原生扩展。自动测试、真实网络、独立 observer 与 Harness 界面分别记录。不宣称完整 RFC 一致性、IPv6 组播或跨子网发现。

- [独立仓库与组件维护](docs/repositories.md)
- [发行说明](docs/release-notes.md)与[发布准备](docs/release-readiness.md)
- [演示步骤](docs/demo-script.md)
- [历史 Windows 网络调查](docs/network-spike.md)

发现核心库、公告器、插件各有独立仓库，Demo 通过 `vendor/` 中版本化包安装，无需相邻源码目录。四项目采用 [MIT](LICENSE)，尚未发布 npm 或镜像 registry。运行目录、证书、key 和用户 profile 不进入发布包。
