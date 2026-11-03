# IETF 五分钟现场演示

本脚本使用当前 Windows 原生 Harness + 已有 Ubuntu WSL 内三个容器的轻量部署。先完成 [Windows 快速部署](windows-quickstart.md) 与 [插件安装](plugin-setup.md)，并预演图片和工具链路。下载依赖、安装插件、构建镜像和初始化信任不计入五分钟。

讲述范围：**真实发现、真实 API 连接与真实客户端工具往返；所有模型响应都是 Mock。** 三个容器共享 WSL 地址，不声称三个独立 LAN IP。Docker Desktop host networking 在本机没有通过组播试验，现场使用已验证的独立 WSL daemon 路线，不临时更改网络设置。

本轮固定使用混合认证：DeepSeek（A Text）和 Qwen3（C Basic）免 API Key；Qwen2.5-VL（A Vision）和 GLM（B Tools）需要演示者手动输入各自的示例 Key。认证要求单独显示，不作为图像、工具等模型能力标签。所有服务仍使用独立批准的 HTTPS 身份、证书和地址范围；免 Key 不等于免除 TLS 检查。

## 演示前准备

在仓库根目录的 PowerShell 中执行：

```powershell
.\scripts\doctor.ps1
npm test
node node_modules/dsh-lan-discovery/verify.mjs
.\scripts\start-demo.ps1
```

确认四个服务出现，并分别预演 Text、Vision 与 Tools 的正常 Harness 新会话。修改本地链接的插件前，先完全退出 Harness；修改后重开，使 Host 和客户端加载同一版本。服务端源码修改后重新构建镜像，尤其保持时钟上下文扩展的两端版本一致。仅在镜像与源码一致时用 `-SkipBuild`。

旧版“四项预填 Key”的 runtime 必须在 Harness 完全退出、演示尚未开始时显式迁移一次，再重建服务。此命令不会启动容器或修改 Harness：

```powershell
node packages/lab-controller/cli.mjs migrate-auth-demo --runtime .runtime/current
.\scripts\start-demo.ps1
```

迁移把 `lab.json`、`server/lab.json`、`client/trust.json` 改为上述混合策略，并移除客户端信任项中的 `tokenFile`。保留原来的 server Key、旧 client token 文件、CA、证书、私钥、marker、runId 与地址授权；重复执行输出 `changed: false`。新初始化的 runtime 已采用混合策略，无需迁移。仅启动旧 runtime 不会替用户执行迁移。

在演示者自己的屏幕打开本地示例 Key 文件，不把内容输出到终端或投影：

```powershell
.\scripts\open-demo-api-keys.ps1
# 只确认文件位置，不打开编辑器：
.\scripts\open-demo-api-keys.ps1 -PathOnly
```

默认位置是 `.runtime/current/presenter/demo-api-keys.txt`。该文件明确标记 **DEMO ONLY**，两条 Key 是本地 Mock 的随机演示凭据，与真实 DeepSeek、Qwen、GLM 账户无关。完整人工路径是打开文件、复制对应模型下的 Key、在 Harness 对话框粘贴；插件不会读取此文件或 `server/tokens.json`，也不会自动从旧 token 文件预填。

准备：

- 一张本地小 PNG/JPEG，建议小于 1 MiB；不使用远程图片 URL。
- 已配置本次 runtime 的 `client/trust.json` 和正确 Windows WSL 接口的 Harness 插件。
- 本次运行的客户端 marker；不要将 marker 内容写进初始提示词或服务端配置。
- 演示者私下打开的 Demo Key 文件；核对 Vision 与 Tools 各自对应一条 Key，投影和录屏中不展示完整内容。
- 一个显示 Harness 的窗口、一个用于节点控制与日志的 PowerShell 窗口。
- 一份已录制的同版本演示，作为现场电脑/投影异常时的备份；回放时明确说明是录屏。

容器操作必须使用专用 WSL daemon，而不是 PowerShell 默认 Docker context。以下 helper 只作用于 `llm-discovery-demo` 项目；按默认 `.runtime/current` 运行：

```powershell
$demoRepo = (Get-Location).Path
$demoRepoWsl = (& wsl.exe -d Ubuntu -u root --exec wslpath -a -u $demoRepo).Trim()
$demoComposeArgs = @(
    '-d', 'Ubuntu', '-u', 'root', '--exec', '/usr/bin/docker',
    '--host', 'unix:///var/tmp/llm-discovery-docker-0/docker.sock',
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

若使用其他已有 WSL 发行版或 runtime，请同时修改 helper 与启动/停止命令。不要指向未检查的 Docker engine。

正式开始前，保留镜像与 runtime，停止演示容器：

```powershell
.\scripts\stop-demo.ps1
```

等待正常撤销传播及 UI 刷新，确认 Harness“局域网服务”列表为空。停止容器不会撤销用户的其他模型配置；如果预演时仍连接了 LAN provider，先点击“断开并恢复默认模型”。

## 0:00—0:30：说明问题和初始状态

打开 Harness 的“局域网服务”页面，保持“开始扫描”。

建议讲述：

> 本机运行着一个真实客户端。服务还没启动，所以列表为空。我们希望进入一个网络后，像查看可用 Wi-Fi 那样查看可用 LLM API；这里发现的是 API 入口，不是 GPU，也不是 Agent。演示使用 Mock，重点是连接信息如何从网络公告进入现有应用。

不要在投影或公开录屏中展示完整 Demo Key 文件、旧 token 文件或用户已有 provider 密钥。

## 0:30—1:15：三个节点、四个服务出现

```powershell
.\scripts\start-demo.ps1 -SkipBuild
```

启动脚本还会执行一次 Windows mDNS 检查。回到 Harness，确认四项：Studio Workstation 的 DeepSeek R1 Distill / Qwen2.5-VL、Lab Server 的 GLM-4-9B-Chat，以及 Mini PC 的 Qwen3-8B。它们仍对应内部的 A Text/Vision、B Tools、C Basic；能力初始可能显示“待确认”。

观察两个免 Key 服务与两个需要 API Key 的服务。先检查免 Key 的 DeepSeek；需要 Key 的服务在用户完成输入前保持能力待确认，不发送未经认证的模型或能力读取。完成输入后，显示 Mock 标识、机器分组、型号、参数量、版本和量化 / 精度。只为图像、工具调用显示特殊能力标签。展开一个“协议与地址”，说明地址、端口和基础路径来自网络记录。型号来自公开模型，规格代表模拟部署，未运行真实权重；不要把这些元数据称为 DNS-SD 草案中的标准能力字段。

> A 同时提供两个 API，其中一个免 Key，另一个需要 Key。它们共用主机，并不意味着应合并为一个服务或共用凭据。公告给出认证要求提示，不携带密钥；能力通过受本地信任策略约束的 API 获取。

## 1:15—2:00：一键接入文本服务

在 DeepSeek-R1-Distill-Qwen-32B（A Text）点击“连接并新建会话”，发送：

```text
请回答 hello，并显示本次响应的节点与服务标记。
```

整个过程不出现 API Key 输入框，客户端请求也不附带 Authorization。确认正常 Harness 会话收到带 `MOCK Node A` 与服务标记的响应。演示的是 Harness 原生模型路径，不是另建网页代替客户端。

> 用户没有手填 base URL。实验策略事先授权了这些服务；接入仍验证服务证书与目标范围。请求由 Harness 直接发给该 API，发现组件不转发推理。

## 2:00—2:45：展示图像输入差异

回到局域网页面，选择 Qwen2.5-VL-7B-Instruct（A Vision）。按界面提示输入对应的 Demo Key，验证通过后再读取模型和能力、连接并新建会话。可在预演或加长演示中先填入 `deliberately-wrong-demo-key`，确认显示认证失败且不暴露能力，再替换为正确 Key。附加准备好的本地图片，发送：

```text
请报告收到图片的字节数、摘要和可读取的尺寸。
```

确认响应包含实际图片字节的 SHA-256，以及支持格式的尺寸。

> 这里验证图片确实通过 Harness 和 API 传递，不声称 Mock 理解了图片。若客户端转码，服务摘要对应转码后的实际发送字节；不能直接假定它与原文件摘要一致。

## 2:45—3:30：真实客户端工具往返

选择 GLM-4-9B-Chat（B Tools），手动输入它自己的 Demo Key，验证后连接并新建会话。Vision 的 Key 不适用于 Tools；不要因为同一网络或同一证书而复用凭据。发送：

```text
请调用 demo_read_marker 读取本次实验标记，然后显示工具回传的结果。
```

通过 Harness 正常的工具权限提示后，展示函数调用、客户端工具执行和最终响应。初始提示词不包含 marker；服务端不能读取客户端 marker 文件。

> API 返回调用结构，Harness 执行固定只读工具并回传结果。服务端没有自主工具执行，也没有联网搜索。能够 function call 不等于具备 web_search。

若工具注册或调用失败，保留错误，不以预置答案冒充回传成功。

## 3:30—4:20：单服务撤销，其他服务保留

在控制窗口向 A 容器中的 Node 进程发送已实现的单服务切换信号。`SIGUSR2` 只切换 A Text，避免使用 Node 保留给调试器的 `SIGUSR1`：

```powershell
Invoke-DemoCompose kill --signal SIGUSR2 node-a
```

观察 Text 从发现列表移除，Vision 仍在。正常 goodbye 的缓存处理约有一秒保护期，UI 约两秒刷新；以实际结果为准，不承诺固定毫秒级延迟。可再次连接 Vision 发一个短文本，确认 A 容器和另一服务仍正常。

再执行相同命令恢复 Text：

```powershell
Invoke-DemoCompose kill --signal SIGUSR2 node-a
```

重新启用会先 probe 再公告。确认 Text 再次出现；列表变化不会自动迁移正在使用其他模型的会话。

## 4:20—5:00：给出可复核证据

用 CLI 获取当前网络候选，不读取信任文件来预填列表：

```powershell
npm run lab -- browse --runtime .runtime/current --seconds 5 --output artifacts/ietf-demo-discovery.json
$demoSeen = Get-Content -LiteralPath artifacts/ietf-demo-discovery.json -Raw | ConvertFrom-Json
$demoSeen | Select-Object instanceName, baseURL, addresses
Invoke-DemoCompose logs --since 10m node-a node-b node-c
```

展示四项候选、不同 base path，以及服务端请求日志中的 service/model/request ID。日志证明 API 接收了请求；mDNS 记录证明候选从网络取得。不要把 HTTP 成功单独称为发现成功。

建议结束语：

> 这个 Demo 表明，统一的发现字段能够把网络中的 API 入口交给现有应用，并支持服务上线和撤销。通用信任 bootstrap、能力接口标准化和完整互操作仍需单独讨论；本次不声称它们已经完成。

## 可选扩展与核验

### 单节点正常停止和恢复

```powershell
Invoke-DemoCompose stop node-b
Invoke-DemoCompose start node-b
```

B 的撤销不应移除 A、C。恢复沿用当前 runtime；若 hostname、IP 或证书改变，应独立更新授权，不按同名继承凭据。

### 异常退出与 TTL

该场景不放入五分钟主线，因为需要等待 TTL：

```powershell
Invoke-DemoCompose kill --signal KILL node-c
```

观察 C 没有正常 goodbye，最终随记录过期消失。默认广告 TTL 为 120 秒，剩余等待时间从最后一次有效刷新计算。结束后恢复：

```powershell
Invoke-DemoCompose start node-c
```

### 保存单服务撤销前后快照

```powershell
npm run lab -- browse --seconds 5 --output artifacts/before-withdrawal.json
Invoke-DemoCompose kill --signal SIGUSR2 node-a
npm run lab -- browse --seconds 5 --output artifacts/after-withdrawal.json
Invoke-DemoCompose kill --signal SIGUSR2 node-a
```

前后应只差 A Text。若现场状态与预演不同，先检查日志；不要连续重复 toggle 猜测当前状态。

### 独立观察与抓包

使用独立安装的 Avahi observer 时，可浏览：

```sh
avahi-browse -rt _llm-api._tcp
```

该命令需要 observer 已在目标链路且 Avahi 可用；它不由本项目单元测试替代。没有执行时，不宣称已取得独立互操作证据。

若已安装 Wireshark/TShark，先通过 `tshark -D` 选出当前 Windows WSL capture interface，再抓取 mDNS：

```powershell
tshark -D
# 将下面的占位接口替换为刚刚核对的 capture interface。
tshark -i 'WINDOWS_WSL_CAPTURE_INTERFACE' -f 'udp port 5353' -w artifacts/ietf-demo-mdns.pcapng
```

启动抓包后再执行上线/撤销，结束时 Ctrl+C。此过滤器不解密 API 流量；API 侧使用脱敏日志关联。应用收到的 datagram JSONL 与 OS 级 pcap 分别标注。

### 混合认证自动验收

```powershell
node scripts/verify-live.mjs
```

该独立测试客户端显式读取 server 侧的合成测试 Key，并通过 `createPinnedTransport(binding, { apiKey })` 只传给需要 Key 的服务；它不代表 Harness 已完成人工输入。验收覆盖四项 `auth` 公告、免 Key 调用、缺 Key / 错 Key / 跨服务 Key 的拒绝、正确 Key 后的模型 / 能力 / 推理访问，以及图像与客户端工具往返。缺 Key 的服务端测试专门绕过客户端前置提示，但保留 TLS、主机名、证书与地址固定；正常 Harness 仍应先提示用户输入。插件把 HTTP 401/403 映射为 `API_KEY_REQUIRED` / `API_KEY_REJECTED`，因此实机报告记录认证错误码，不将它等同于直接观察原始 401；具体 401 由服务端 API 测试核验。报告不包含 Key。

## 收尾

在 Harness 点击“断开并恢复默认模型”，随后：

```powershell
.\scripts\stop-demo.ps1
```

停止脚本保留 runtime、信任、镜像和隔离 daemon，方便再次演示。不要把 `.runtime/`、token、私钥或客户端 marker 放进公开证据包。公开内容包括代码版本、脱敏测试输出、候选快照、可核查日志以及经过检查的抓包。

需要完整协议说明、当前未实现项目和 API 限制时，使用 [protocol-mapping.md](protocol-mapping.md)，不要以现场演示代替完整标准一致性声明。
