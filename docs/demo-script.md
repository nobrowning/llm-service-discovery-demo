# IETF 五分钟现场演示

两个节点、三个 API，可用 [macOS/Linux/Windows 原生进程](native-quickstart.md)或 [Windows/WSL 两容器](windows-quickstart.md)。Mac Desktop 先完成 [Mac 安装与会话检查](mac-desktop-quickstart.md)；其他路线完成[插件安装](plugin-setup.md)和 [API key 三状态准备](api-key-demo.md)。下面分别给出 native 与 Windows/WSL 命令，不要交叉执行。下载、构建、信任初始化和预保存 GLM 不计入五分钟。Linux 的 Web Host 界面须单独验收，服务端测试通过不自动代表完整 UI 可用。

讲述范围：真实 mDNS 发现、HTTPS/SSE、图像字节传输与客户端工具往返；模型响应全部是 Mock。原生路线是本机两个 Node 进程，容器路线是 WSL 中两个容器；各路线的两个节点共享一个 IP，通过端口与路径区分服务，不声称各有一个 LAN IP。

## 演示前准备

旧四服务 runtime 先断开 LAN 连接、完全退出 Harness，并停止该 runtime 的服务，再运行 `node packages/lab-controller/cli.mjs migrate-three-state-demo --runtime 实际目录`，最后按所选路线启动。只启动旧目录不会隐式迁移；不要在服务运行时改写其配置。停止命令见本文末尾，runtime 参数须与实际目录一致。

### macOS/Linux 原生服务

在 Demo 目录确认 Node.js 24+，用 `list-interfaces` 选择本机 LAN IPv4。下文 `192.168.1.10` 需替换；原生示例固定使用 `.runtime/native`。

```sh
node packages/lab-controller/cli.mjs list-interfaces
npm test
node packages/lab-controller/cli.mjs native run --runtime .runtime/native --interface 192.168.1.10
```

最后一条在前台持续运行，保持此终端开启。在另一个终端进入相同目录：

```sh
node packages/lab-controller/cli.mjs native status --runtime .runtime/native
node scripts/verify-live.mjs --runtime .runtime/native
```

Windows 原生 Node 也可使用这些 `node` 命令。Linux 此处验证服务端/独立客户端；下文 UI 演示必须使用已完成对应 Host 安装与功能检查的客户端。

### Windows/WSL 容器

```powershell
.\scripts\doctor.ps1
npm test
.\scripts\start-demo.ps1
node scripts/verify-live.mjs
```

### 两条路线共同准备

点击 GLM 服务行展开，输入本地合成 key，保留“记住 API key”，验证成功后断开；Qwen-VL 不保存 key。重启 Harness 后核对三种状态：

- DeepSeek R1 Distill：无需 key。
- GLM-4-9B-Chat：已保存 key，展开后可直接连接。
- Qwen2.5-VL：尚未填写 key，需要输入。

保存使用 Harness 官方凭据服务，当前默认 provider 是本地未加密 YAML；页面不回传 key。取消“记住 API key”可以仅本次使用。详细保存、清除和身份边界见 [API key 说明](api-key-demo.md)。

准备一张本地小 PNG/JPEG、正确的插件 trust/interface 配置、客户端 marker，以及私下打开的 presenter key 文件：native 为 `.runtime/native/presenter/demo-api-keys.txt`，Windows/WSL 为 `.runtime/current/presenter/demo-api-keys.txt`。不要在投影中显示 key 或 marker 内容。所有 key 只对本机 Mock 有效，不是模型厂商凭据。

仅 **Windows/WSL** 需要以下容器命令初始化；macOS/Linux native 跳过此块。它使用项目专用 WSL daemon，避免 Docker Desktop 的 CLI 链接：

```powershell
$demoRepo = (Get-Location).Path
$demoRepoWsl = (& wsl.exe -d Ubuntu -u root --exec wslpath -a -u $demoRepo).Trim()
$demoComposeArgs = @(
    '-d', 'Ubuntu', '-u', 'root', '--exec', 'sh',
    "$demoRepoWsl/spikes/network/wsl-engine.sh", 'docker',
    'compose', '--project-name', 'llm-discovery-demo',
    '-f', "$demoRepoWsl/deploy/compose.yaml",
    '-f', "$demoRepoWsl/.runtime/current/compose.runtime.json"
)
function Invoke-DemoCompose {
    & wsl.exe @demoComposeArgs @args
    if ($LASTEXITCODE -ne 0) { throw "Demo Compose failed: $LASTEXITCODE" }
}
Invoke-DemoCompose ps
```

容器路线使用其他已有发行版或 runtime 时同步调整上方路径。正式开始前点击 Harness 的“断开并恢复默认模型”，再按所选路线停止服务：

```sh
# macOS/Linux/Windows native：在另一个终端执行
node packages/lab-controller/cli.mjs native stop --runtime .runtime/native
```

```powershell
# Windows/WSL
.\scripts\stop-demo.ps1
```

等待撤销传播，确认本次 Demo 的三项服务从列表消失；同网段其他人的服务可以仍然存在。GLM 保存的 key 保留。

## 0:00—0:30：说明需求

保持 Harness“局域网服务”的扫描开启：

> 我们希望进入一个网络后，像查看 Wi-Fi 一样查看可用 LLM API。这里发现的是 API 入口，不是 GPU 或 Agent。服务尚未启动，所以列表为空；配置文件不会凭空生成候选。

## 0:30—1:15：两个节点、三个服务

macOS/Linux native：在专门的服务终端重新前台运行，保持终端开启：

```sh
node packages/lab-controller/cli.mjs native run --runtime .runtime/native --interface 192.168.1.10
```

Windows/WSL：

```powershell
.\scripts\start-demo.ps1 -SkipBuild
```

确认 Studio Workstation 上的 DeepSeek、Qwen-VL，以及 IP 标识节点上的 GLM 出现。列表初始只展示服务信息和 key 状态，像 Wi-Fi 选择器一样点击某项才展开操作区。选中不会自动接入；在展开项内打开“协议与地址”，展示 `.local` 主机名、端口及 base path。

三种状态同时可见：DeepSeek 无需 key；GLM 已保存；Qwen-VL 待输入。能力在检查成功后显示，特殊标签仅包括图像和工具调用；型号、参数量、版本及量化是模拟部署元数据。

左上角不再为每项显示 Mock 或已发现标签。只有已有插件路由的服务显示“已接入”；模拟性质在服务声明 `mock: true` 后作为展开详情中的说明。真实部署使用同一界面，不需要“非 Mock”标签。已保存 key 不是连接成功证明。

> A 同时提供两个独立 API，一项免 key、一项要求 key。共享主机不代表共用凭据。已保存是客户端的状态；网络公告不包含 key，也不告诉其他客户端你是否配置过。

## 1:15—2:00：免 key 与已保存 key 均可一键接入

展开 DeepSeek 并点击连接，新会话发送：

```text
请回答 hello，并显示本次响应的节点与服务标记。
```

确认 `MOCK Node A` 响应。客户端不附带 Authorization，也没有输入 base URL。

再返回服务页连接 GLM，直接新建会话，不要求重填 key：

```text
请回答 hello，并显示本次响应的节点与服务标记。
```

确认 `MOCK Node B` 响应。

> 免 key 服务与已经配置过的服务都能快速接入。保存的 key 只属于这个已授权服务身份；即使另一个服务名称相同，也不能继承它。

## 2:00—2:45：尚未配置的服务与图像差异

选择 Qwen-VL。可先填 `deliberately-wrong-demo-key`，确认认证失败且密码框清空，再输入它自己的正确合成 key。为演示后保留初始布局，可取消“记住 API key”，使 Vision 仅本次使用。验证成功后附加本地图片，发送：

```text
请报告收到图片的字节数、摘要和可读取的尺寸。
```

确认实际接收字节的 SHA-256 与支持格式的尺寸。不声称 Mock 理解图片；客户端若转码，摘要对应实际发送字节。

## 2:45—3:30：真实客户端工具往返

展开已经保存 key 的 GLM 并连接，发送：

```text
请调用 demo_read_marker 读取本次实验标记，然后显示工具回传的结果。
```

按照 Harness 的正常工具授权流程操作。展示 API 返回函数调用、客户端执行固定只读工具并回传、服务端响应。初始提示词不包含 marker；工具结果和随后 Mock 回复会包含 marker 原文，公开投影或录屏时遮挡该内容，留存证据使用调用 ID 与摘要。Windows/WSL 路线的服务容器只挂载 server 目录，不包含客户端 marker；原生两个进程与客户端可能属于同一用户，不能把进程分离当作文件权限隔离。两条路线都依据实际 Host 工具执行和调用 ID 关联核验。

> 服务提供函数调用结构；Harness 执行工具。函数调用不等于服务端自主执行，也不等于联网搜索。

若工具调用失败，保留错误，不以预置答案替代真实执行。

## 3:30—4:20：单服务撤销和恢复

macOS/Linux native：在控制终端执行自动生命周期演示：

```sh
node scripts/verify-lifecycle.mjs --backend native --runtime .runtime/native --output artifacts/ietf-demo-lifecycle.json
```

脚本通过该 runtime 的本机控制通道撤销 A Text、验证 Vision 仍可访问，再恢复，记录 3→2→3。此过程不使用 OS 信号。界面约两秒轮询，短暂的两服务状态可能落在刷新之间；按实际观察记录，完整顺序以脚本的实时发现证据核对。

Windows/WSL：保留手动切换以便停留在两服务状态：

```powershell
Invoke-DemoCompose kill --signal SIGUSR2 node-a
```

`SIGUSR2` 只切换 A Text。观察三项变两项，Vision 仍可请求；正常 goodbye 有约一秒缓存保护，界面约两秒刷新，以实际时间为准。

```powershell
Invoke-DemoCompose kill --signal SIGUSR2 node-a
```

恢复为三项。重新启用先 probe 再公告，不自动改变正在使用其他模型的会话。

## 4:20—5:00：给出可核查证据

macOS/Linux native：

```sh
node packages/lab-controller/cli.mjs browse --runtime .runtime/native --seconds 5 --output artifacts/ietf-demo-discovery.json
node packages/lab-controller/cli.mjs native status --runtime .runtime/native
```

展示发现快照、生命周期报告和实际 Harness 会话/工具执行记录。native 状态仅证明本次托管进程的状态，不把它当作请求日志；需要完整独立 API 核验时使用下方 `verify-live`。

Windows/WSL：

```powershell
npm run lab -- browse --runtime .runtime/current --seconds 5 --output artifacts/ietf-demo-discovery.json
$demoSeen = Get-Content -LiteralPath artifacts/ietf-demo-discovery.json -Raw | ConvertFrom-Json
$demoSeen | Select-Object instanceName, baseURL, addresses
Invoke-DemoCompose logs --since 10m node-a node-b
```

展示本次三项候选、不同路径，以及会话或容器请求记录中的 service/model/request ID。mDNS 证明发现来自网络；请求记录证明实际收到请求，二者不可替代。

> 同一套发现字段把网络 API 入口交给现有客户端，并支持上线、撤销与凭据状态不同的接入流程。通用信任引导和能力接口标准化仍需继续讨论。

## 可选核验

- 正常节点停止（仅 Windows/WSL）：`Invoke-DemoCompose stop node-b` / `start node-b`；B 撤销不影响 A。
- 异常退出（仅 Windows/WSL）：`Invoke-DemoCompose kill --signal KILL node-b`，等待 TTL 过期再 `start node-b`。默认 TTL 120 秒，从最后刷新起计；不纳入五分钟主线。
- 真实网络认证：native 使用 `node scripts/verify-live.mjs --runtime .runtime/native`，Windows/WSL 使用 `node scripts/verify-live.mjs --runtime .runtime/current`。独立客户端显式读取 server fixture，覆盖免 key、缺 key、错 key、跨服务 key 和正确 key，不代表已经验证桌面保存流程。报告仅记录脱敏状态和结果。
- 生命周期：native 使用 `node scripts/verify-lifecycle.mjs --backend native --runtime .runtime/native`，Windows/WSL 使用 `node scripts/verify-lifecycle.mjs --runtime .runtime/current`；均验证 3→2→3 且 Vision 在 Text 离线时仍可请求。
- 独立 DNS-SD：macOS 可在终端运行 `dns-sd -B _llm-api._tcp local.`，结束按 Ctrl+C；Linux 在目标链路使用 `avahi-browse -rt _llm-api._tcp`，或快速部署说明中的 python-zeroconf。实际执行才构成独立观察证据。
- 若抓包，先用 `tshark -D` 核对当前接口，再按 `udp port 5353` 过滤；公开前检查 IP、主机名和其他局域网数据，不把应用 datagram 日志当作 OS 抓包。

## 收尾与重置

清除 Vision 的本次/保存 key，保留 GLM 已保存，点击“断开并恢复默认模型”。需要再次核对保存行为时完全退出并重启 Harness。

macOS/Linux native：

```sh
node packages/lab-controller/cli.mjs native stop --runtime .runtime/native
```

Windows/WSL：

```powershell
.\scripts\stop-demo.ps1
```

native 停止只管理该 runtime 的两个子进程；Windows/WSL 停止只作用于本 Compose 项目。两者保留 runtime、信任和保存的客户端凭据，容器路线也保留镜像。`.runtime/`、Harness profile、私钥和 marker 不进入公开证据包。历史验收见[验证报告](validation-report.md)，不要用它代替当前平台、Host 和插件版本的真实会话验收。
