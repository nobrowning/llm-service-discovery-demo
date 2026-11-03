# macOS：原生 Demo 与 Harness Desktop

本指南使用 Demo **0.6.2** 的 native ZIP、随附插件 **0.5.2**，以及已核对 Host 接口的 Harness Desktop **0.2.1-rc.5**。插件也声明兼容 rc.3；其他 Host 版本应重新检查接口。安装包检查、网络检查和真实桌面会话分别记录，已执行范围以[验证报告](validation-report.md)为准，本指南本身不代表所有界面步骤已经验收。

## 准备原生服务

从 [Demo Release](https://github.com/nobrowning/llm-service-discovery-demo/releases/tag/v0.6.2) 下载 `llm-service-discovery-demo-0.6.2-native.zip`，使用 `shasum -a 256 文件.zip` 与同页 `SHA256SUMS` 核对后解压。准备适合本机 Apple Silicon 或 Intel 的 Node.js 24+；Harness 自带的 CLI 运行时不会自动把终端的 `node` 命令装好。也可将官方 Node 归档解压到用户目录，临时把其 `bin` 加入当前终端的 `PATH`。

在解压目录执行：

```sh
node --version
node scripts/verify-release-files.mjs
node scripts/verify-components.mjs
node packages/lab-controller/cli.mjs list-interfaces
```

如果使用源码 checkout 或 GitHub Source code 归档，先执行 `npm ci --ignore-scripts`，跳过仅部署 ZIP 才有清单的 `verify-release-files.mjs`。

从网卡列表选择 Mac 的局域网 IPv4。下文 `192.168.1.10` 是示例，必须替换；VPN、虚拟机接口不一定与另一台客户端相通。打开一个专门的服务终端：

```sh
node packages/lab-controller/cli.mjs native run --runtime .runtime/native --interface 192.168.1.10
```

保持终端开启，等待 `state: running` 和 A/B 两节点就绪。两个本机进程分别提供 API 与 mDNS 公告，使用 TCP 18443、28443 和 UDP 5353；无需 Docker。首次创建实验 CA、证书和合成 key，重启复用它们。另开终端，在同一目录检查：

```sh
node packages/lab-controller/cli.mjs native status --runtime .runtime/native
node scripts/verify-live.mjs --runtime .runtime/native
```

`verify-live` 是独立网络/API 验证器，不能替代下面的 Harness 图形界面测试。

## 安装到已有 Harness

先打开 Harness Desktop 一次，让应用初始化自己的 `desktop` profile，然后从应用菜单选择退出或按 Command-Q。仅关闭窗口可能仍让 Mac 应用运行。已有用户先在插件中断开连接，再完全退出。

在 Demo 解压目录使用该 `.app` 自己的 CLI；应用路径不同则替换：

```sh
DSH='/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh'
"$DSH" --version
"$DSH" plugin --profile desktop add "$PWD/vendor/dsh-lan-discovery-0.5.2.tgz" --ignore-scripts
```

不要用另外安装的全局 CLI 修改 Desktop profile。rc.5 的共享路径契约默认使用 `~/.dsh`；显式配置或 `DSH_HOME` 可覆盖它。下面的 `profiles/desktop/cordis.patch.yml` 必须位于**这次 Desktop 实际使用的 Harness home**。不要为安装命令临时设置另一个 `DSH_HOME`，否则 GUI 与 CLI 可能操作不同 profile。

修改前备份该 profile 的配置文件，保留其他插件、模型和设置。插件安装包已经提供 `lan-discovery` 的基础条目；在用户 `cordis.patch.yml` 的 YAML 列表中合并下面的覆盖项：若已有同 ID 的配置则编辑它，若没有则新增这一项，不要替换整个文件或另建重复的 `insert` 条目。

```yaml
- id: lan-discovery
  name: dsh-lan-discovery
  config:
    trustFile: '/Users/alice/demo/.runtime/native/client/trust.json'
    interfaceAddress: '192.168.1.10'
    networkId: 'ietf-demo'
    autoStart: true
    demoMode: true
```

把路径改为自己的真实绝对路径。可在 Demo 目录运行 `pwd -P` 获取目录前缀；YAML 配置不展开 `~` 或 `$HOME`。`interfaceAddress` 始终是**运行 Harness 的 Mac 自己**的 IPv4。若服务运行在另一台机器，经可信通道取得其 `client/` 信任目录，并使用 Mac 本地保存的绝对路径；普通客户端不需要服务端私钥目录。默认状态文件写在 trust 文件旁，若该目录只读，再显式指定可写的绝对 `stateFile`。

重新打开 Harness，确认“局域网服务 / LAN services”出现在侧栏并能列出三项服务。若没有侧栏，先检查所用 Host 版本、实际 profile、插件安装是否成功和启动错误，不通过重复追加配置解决。

## 在真实会话中检查

在自己的屏幕查看 `.runtime/native/presenter/demo-api-keys.txt`，只使用其中对应服务的合成 key，不将 key 或 marker 内容写进共享日志、截图或初始提示词。接着逐项执行：

| 服务 | 操作与预期 |
|---|---|
| DeepSeek 文本 | 展开、检查并连接，不输入 key；在新会话发送文本，确认出现本次 Mock 节点与服务标记、流式响应正常。 |
| GLM 工具 | 输入对应合成 key，勾选“记住 API key”并验证连接；断开后仍显示已保存。完全退出并重新打开 Harness 后再次连接，确认无需重填。 |
| Qwen-VL 图像 | 先提交 `deliberately-wrong-demo-key`，确认认证失败且输入框清空；再输入正确 key并取消“记住 API key”。在新会话附加一张小 PNG/JPEG，要求报告收到字节的摘要和尺寸；如果客户端转码，摘要对应发送后的字节。退出 Host 后应不再保留仅本次使用的 key。 |

连接 GLM 后，在新会话要求调用 `demo_read_marker`。按 Harness 实际显示的工具权限流程操作，观察函数调用、Host 本地工具执行与结果回传。工具结果和随后 Mock 回复会包含 marker 原文，公开截图或录屏前需遮挡；留存证据以调用 ID 和脱敏摘要核验。普通文本回显或独立 `verify-live` 通过，都不能代替原生工具运行时验收。

在 Harness 设置中分别选择中文和英语，确认侧栏、页面按钮与错误信息跟随切换；服务名称、协议字段和 `.local` 地址保持原值。模型名称是模拟部署标签，不代表 Mac 正在运行模型权重。

保存 key 使用当前 Harness credential provider；其默认实现是本地未加密 YAML，不应把“已保存”描述为 macOS Keychain。保存状态只表示本地有凭据，连接时仍会检查服务与 TLS 信任。

## 生命周期、重启与停止

保持服务终端运行，在另一个终端执行：

```sh
node scripts/verify-lifecycle.mjs --backend native --runtime .runtime/native
```

该脚本通过受认证的本机控制通道自动撤销 A 的文本服务，再恢复，核验 3→2→3 和 Vision 持续可用。它不需要 `SIGUSR2`、PowerShell 或 WSL。Harness 页面会轮询刷新；短暂状态可能落在两次刷新之间，脚本结果和界面观察分别记录。

退出前点击插件的“断开并恢复默认模型”，确认自己的原默认模型恢复，再完整退出并重开 Harness，检查 GLM 保存状态、Qwen 会话 key 清除和插件页面。若测试“仍连接时退出后的恢复”，先记录原默认模型；重启后检查恢复日志/提示，不把只看到页面重新出现当作默认模型已经恢复。升级、禁用或卸载插件前先断开。

rc.5 实测中，连接着 LAN 模型时禁用再启用插件可能显示 `HMR transactions cannot be nested` 和待恢复状态。这时恢复日志仍保留；回到局域网服务页点击“断开并恢复默认模型”可重试恢复。不要删除状态文件或重新选择 LAN 服务来掩盖错误。

停止服务可以在服务终端按 Ctrl+C，或在同目录的另一终端执行：

```sh
node packages/lab-controller/cli.mjs native stop --runtime .runtime/native
```

停止保留 runtime、证书、信任和合成 key。重新运行相同启动命令可复用；IP 改变或目录不完整时，选择新 runtime 并重新配置实验信任，保留旧目录供检查。不要通过删掉 runtime 来解决保存 key、默认模型恢复或安装路径问题。

## 本地网络权限与排查

若原生验证器能发现服务，Harness 页面却始终为空，先展开插件的“事件记录”，保留系统错误码与错误类别，并检查所选接口仍属于 Mac 本机。终端/SSH 启动的命令行工具在 macOS 上会自动获准访问本地网络；它们成功不能证明图形应用具有相同权限。Apple 的 [TN3179 本地网络隐私说明](https://developer.apple.com/documentation/technotes/tn3179-understanding-local-network-privacy)明确区分这两类进程。

在“系统设置 → 隐私与安全性 → 本地网络”中检查 **DeepSeek Harness**，为该应用允许本实验所需的本地网络访问；系统可能在应用首次尝试访问后才把它加入列表。处理实际显示的提示后，重新尝试扫描，必要时完整退出并重开 Harness。按系统设置的实际项目检查，不能把“没有弹窗”当作已授权，也不能把所有发现失败都归因于权限。

同时核对网卡地址、UDP 5353 组播、服务进程、VPN/访客网络隔离和 TCP 18443/28443。macOS 不要求 iOS 专用的 multicast entitlement。若出现应用防火墙或文件/工具权限提示，核对请求方与本实验用途后处理；本流程不需要关闭系统防火墙、停用 Bonjour、开放完全磁盘访问或修改系统证书库。更多网络排查见[原生部署](native-quickstart.md)，演示流程见[现场演示](demo-script.md)。
