# 验证报告

更新日期：2026-11-03。当前 0.4.0 使用两个容器、三个服务，展示免 key、已保存 key、待输入 key。各版本的实测范围分别记录如下，历史结果不替代当前版本验收。

## 0.4.0 三状态与持久化验收

插件接入 Harness 官方 credentials record API，仅保存 `lan-discovery/service-<identity>` 自有记录。默认勾选记住 key，取消后仅本次运行有效。其存储保护沿用 Harness provider；当前默认 provider 为本地未加密 YAML。API key 不进入 UI 状态、浏览器存储、日志、普通配置或恢复 journal。

本轮插件 **43/43**、Demo **42/42** 测试通过。新增覆盖：保存后重新创建控制器可恢复、错误替换不覆盖旧 key、保存失败不声称成功、从保存切换为仅会话会删除持久副本、身份变化不复用 key、服务离线后可清除旧凭据、存储不可用降级为仅会话，以及中英 UI 三种状态。核心与公告器未变更。

本机显式迁移旧 runtime，保留 run ID、CA、证书和原 key 文件；停止并移除本项目旧 C 容器，A/B 容器自行公告三个服务。真实网络 **24/24** 检查通过，包括受保护 API 的缺 key、错 key、跨服务 key 拒绝，正确 key 下的文本、图像及工具往返。生命周期 **7/7**，真实 mDNS 数量为 **3→2→3**，文本服务撤回期间同节点视觉 API 继续响应。

通过 Desktop 自带 CLI 安装插件 0.4.0，已安装 controller 与源码 SHA-256 一致。在 Harness rc.5 原生界面，GLM 输入本机合成 key 并勾选记住，验证成功后显示已保存；断开后完整退出，再启动时 GLM 仍显示已保存、DeepSeek 免 key、Qwen-VL 输入框为空，原默认模型保持正常。重启后不再输入 key，直接连接 GLM 并发送测试消息，实际收到 Node B Mock 响应。未读取或直接编辑 Harness 的用户凭据文件；保存通过官方 provider 完成。

其他人首次部署时按 [API key 演示步骤](api-key-demo.md) 在 UI 保存一次 GLM key；仓库不预置任何通用密码。当前网络报告为本机 `artifacts/live-verification.json` 与 `artifacts/lifecycle-verification.json`，运行时材料不会提交。

## 0.3.1 与 Harness rc.5 复验

2026-11-03 核对已安装 rc.5 的 Host、前端、设置、附件与工具接口后，插件 0.3.1 显式支持 rc.3 / rc.5，不使用版本豁免。28 项插件测试与 41 项 Demo 集成测试继续通过。通过 Desktop 自带 CLI 安装 tarball，安装的 controller 与独立源码哈希一致。

在 rc.5 正常界面重新发现四个服务：DeepSeek 免 key 接入后完成原生文本请求；GLM 输入对应演示 key 后验证、创建会话并完成原生文本请求，两次均显示 Mock 服务响应并完成用时 1 秒。启动时此前 LAN 默认恢复为原用户模型，且上一运行的 key 不再预填。此次不扩展宣称 rc.5 原生图片或工具回合已重测；对应功能继续由真实网络检查覆盖。

续验时发现 Docker Desktop 的 WSL CLI 链接失效。启动、停止与 doctor 已改用项目专用 static CLI；需要时校验并缓存 Compose 2.32.4。专用 daemon、原有三容器、地址与信任材料均保留。实际启动与四服务发现恢复后，真实网络检查再次 **29/29**，不需要运行 Docker Desktop 来提供 CLI 链接。

## 0.3 混合 API key 验收

2026-11-02 完成混合认证：DeepSeek 和 Qwen3 免 key，Qwen-VL 与 GLM 要求各自的 key。四仓在新的隔离目录通过离线安装及 **94/94** 测试（core 10、公告器 15、插件 28、Demo 41）。覆盖缺 key、错误 key、跨服务 key、正确 key、无凭据请求、密码框立即清空、失败重试、身份变化或离线后的清除、默认模型恢复、内存生命周期及错误不回显凭据。

容器自行公告四个服务，真实网络验证 **29/29**，生命周期验证 **7/7**。网络验证的认证失败证据是经过插件脱敏的错误码；HTTP 401 原始状态另由服务测试断言，不混为同一项证据。图像摘要和客户端工具往返继续通过。旧 runtime 迁移保留原证书、服务端 key、marker 和 run ID，不再在客户端预填 key。

在 Harness Desktop rc.3 原生界面完成：缺 key 提示 → 错 key 被拒绝且输入清空 → 正确演示 key 验证 → 自动建立 GLM 会话 → 实际 Mock HTTPS/SSE 响应。DeepSeek 也通过免 key 一键接入并成为新会话模型。该轮未重复原生图片附件或原生工具调用；对应网络与历史桌面证据分别保留。

当前网络报告为 `artifacts/live-verification.json` 与 `artifacts/lifecycle-verification.json`。独立安装报告保留于本机隔离验收目录；下方 0.2.0 及更早桌面记录是历史验收，不代表重新执行。

## 0.2.0 国际化与独立仓库验收

四个仓库在全新的隔离目录中分别通过 `npm ci --ignore-scripts --offline` 和测试，共 65/65（core 7、公告器 14、插件 12、Demo 32）。所有依赖解析均位于隔离目录，不依赖原工程或兄弟目录链接。插件另通过实际 Git clone、LF 换行归一化后的构建与 12/12 测试，构建后 Git 工作区保持干净。离线安装使用本机 npm 缓存，不表示首次安装不需要获取外部依赖。

实际 Desktop 0.2.1-rc.3 通过官方 CLI 安装 `vendor/dsh-lan-discovery-0.2.0.tgz`；安装目录为普通目录，已不再链接原开发源码，浏览器 bundle 与独立插件源码产物一致。旧链接升级采用官方 remove/add 流程完成，原信任配置保留，并显式开启 Demo 专用的 `demoMode`。

通过 Harness 的正常设置页面执行中文 → English → 中文：插件侧栏、标题、操作按钮、能力标签和状态即时切换，已检查的型号/IP保持原值。英语页面一键接入 GLM Mock，并在正常会话执行 `demo_read_marker`、收到相关联工具返回，显示 2 步且完成用时 1 秒。验收后断开连接并恢复中文。此次未重新执行原生图片附件流程，原验收记录保留为历史证据。

新版镜像从 Demo 的组件安装包离线构建，实际容器 mDNS → HTTPS 检查 17/17，生命周期 4 → 3 → 4 检查 7/7。记录见本机 `artifacts/clean-install-verification.json`、`artifacts/i18n-repositories-verification.json` 与更新后的网络报告。所有源码仓库均为本地 Git，尚未发布远端或 npm；CI 已配置，远程 CI 尚未执行。

## 环境与拓扑

| 项目 | 实际环境 |
|---|---|
| 客户端 | Windows，Node.js 24.21.0 |
| Harness | 已安装 Desktop 0.2.1-rc.3，本地插件成功加载到侧栏 |
| 服务端 | 已有 Ubuntu WSL，专用 Docker Engine 27.5.1 |
| 编排 | Compose 2.32.4，三容器使用 WSL host network |
| 节点 | A Text/Vision，B Tools，C Basic，共四服务 |
| 公告来源 | 各服务容器中的 Node 进程；Windows 无公告器 |
| 网络形态 | 三容器共享 WSL IP，端口/路径区分；不是三个独立 LAN IP |
| 模型 | 全部 Mock；无模型权重、GPU 或外部推理请求 |

Docker Desktop 4.38.0 host networking 路线在本机未能通过 mDNS 验证；最终不依赖该链路。为诊断启用过的开关已通过官方 UI 取消勾选并 Apply & restart，恢复为关闭；随后验证专用 WSL daemon 的三容器持续运行、Windows 发现四项服务。防火墙提示由用户手动处理，没有自动修改防火墙、WSL 网络模式或系统证书库。

## 已通过

| 检查 | 结果 | 证据与边界 |
|---|---|---|
| 四仓自动测试 | 65/65 | core 7、公告器 14、插件 12、Demo 32；包含国际化、独立 CLI、展示元数据、旧 runtime 兼容、缓存、TLS、SSE、图像、工具、配置事务、上下文与启动恢复 |
| 真实 mDNS → HTTPS | 17/17 | artifacts/live-verification.json；四服务、流式与非流式、图像摘要、工具关联结果 |
| 单服务生命周期 | 7/7 | artifacts/lifecycle-verification.json；真实发现 4 → 3 → 4 |
| 独立 DNS-SD 实现 | 4/4 服务 | artifacts/interop.json；Windows python-zeroconf 0.153.0，未发布服务 |
| 启动脚本重复执行 | 通过 | 默认 start-demo.ps1 实际构建、Compose 重建、四项发现；复用原 token/CA |
| 实际停止与重新启动 | 通过 | artifacts/start-stop.json；本项目运行容器 3 → 0 → 3，恢复发现 4/4；11 个信任/敏感文件前后未改 |
| 插件安装及加载 | 通过 | 使用已安装 Desktop 自带 CLI；侧栏出现“局域网服务” |
| Harness 服务列表与能力过滤 | 通过 | 实际原生页面发现四项；逐项检查能力，图像和函数调用筛选分别显示对应服务 |
| Harness 原生文本会话 | 通过 | 最终版本 mock-text；正常会话收到 Node A / Text 标识及实际用户提示回显，显示完成用时 1 秒 |
| Harness 原生基础服务 | 通过 | mock-basic；正常会话收到 Node C / Basic 标识及实际用户提示回显，显示完成用时 1 秒 |
| Harness 原生图片会话 | 通过 | 最终版本 mock-vision；正常附件 UI 发送 PNG，服务收到 1012 字节、320×192，SHA-256 与原文件一致 |
| Harness 原生工具往返 | 通过 | mock-tools；正常会话显示 2 步和“已调用工具”，demo_read_marker 的返回值与客户端 marker 哈希核对一致 |
| Harness 冷启动默认恢复 | 通过 | 剩余 LAN 默认被条件恢复为 DeepSeek-V4.1-Flash High；journal 的 baseline/lastWritten 清空 |
| Harness 断开恢复默认 | 通过 | 点击断开后四项“已配置”消失；新建空会话选中原来的 DeepSeek-V4.1-Flash High，journal 清空 |
| 原始网络 spike | 通过 | docs/network-spike.md 与本地报文 JSON 日志；不是完整 pcap |

单服务生命周期本次耗时约 6 秒：初始四项、A Text 撤销为三项、恢复到四项。Text 停用时实际返回 HTTP 503；同主机名下 Vision 仍成功接受 HTTPS 请求。报告中的阶段耗时包括控制和观察开销，不是协议延迟保证。

真实网络验证使用插件本身的 scoped transport / ResponsesAdapter；组件拆分并改为 0.2.0 安装包后再次通过 17/17，单服务生命周期也重新通过 7/7。该脚本的工具 marker 由**独立验证客户端**读取并回传，服务容器没有挂载客户端 marker；它与 Harness 原生工具验收分别记录。

原生页面使用标准 same-origin `fetch`，由 Desktop shell 转发到认证后的 Host；Host 注册六条 owner-only exact Fetch 路由。文本、图片和工具均由正常会话调用服务，并非插件中的独立测试聊天框。图片摘要为 `02d9c98bb7d899eebaa4df68b41c6e86383915d16dfc25e8151e62a2aa01953f`。

原始完整原生验收在 17:42—17:48（香港时间）完成。Tools 的初始提示只请求执行固定工具，不包含 marker；随后客户端工具结果携带对应 call_id 回到容器，最终显示实际 nonce。以 UI 中实际返回值计算哈希，与本地 marker 文件比较（允许展示省略末尾换行），结果一致。报告不保存 marker 正文，也不把未取得的 Host 文件日志算作证据。原生验收摘要见 `artifacts/desktop-verification.json`，其中测试计数与旧展示名称保留当时的历史记录。

模型展示更新后，再次在实际 Harness 检查四张服务卡片：展示 DeepSeek、Qwen 和 GLM 型号、参数量、版本及量化 / 精度，只显示图像输入和工具调用这两种特殊能力标签。所有服务保留 Mock 标识；两个 A 节点服务显示相同的 Studio Workstation 机器名。19:31（香港时间）通过“连接并新建会话”接入 DeepSeek-R1-Distill-Qwen-32B，原生会话模型显示 `DeepSeek-R1-Distill-Qwen-32B · Q4_K_M · Mock`，实际本地请求成功回显验收提示并显示完成用时 1 秒。此次展示复验不重复计算原生图片、工具和生命周期验收；详见 `artifacts/presentation-verification.json` 和 [展示字段说明](model-presentation.md)。

Mock 通过明确的 Host 来源标注识别时钟、技能目录、指令上下文和运行环境快照，保留原始角色与内容；真实用户回合和未知来源保持原语义。最终桌面 Text/Basic 已正确回显用户提示，Tools 已完成真实调用。该约定为实验扩展，见协议映射。

部署位置展示后续补充已部署并通过实际 Harness 页面检查：A 两服务保留 `Studio Workstation`，B 显示运行配置中的 IP，C 显示实际公告的 `.local` 主机名。该补充重新通过 API 测试 23/23 与真实网络验证 17/17，未改连接身份或信任材料；证据见 `artifacts/location-verification.json`。前一份 `presentation-verification.json` 保留改位置前的机器显示名称。

## 尚待完成

1. 第二台干净机器安装复现；物理断开公网演示。
2. npm 与镜像 registry 正式发行；MIT 和独立插件打包已经完成。
3. 完整 RFC 一致性、完整 pcap、IPv6 实机互通、跨网段发现均没有验证。

启动恢复曾在插件 apply 内等待配置写入，引发 Loader 循环等待；已将恢复推迟到激活返回、Loader 稳定后，并通过真实冷启动复验。开发时 HMR 清空临时 provider，若恢复遇到嵌套配置事务，错误保持可见并允许通过断开按钮重试。修改本地插件前先退出 Harness，完成后重开；禁用或卸载前先断开并确认恢复。关闭或断开后的旧 LAN 会话保留历史，再次推理需要重新接入对应服务。

## 重新验证

```powershell
npm test
.\scripts\doctor.ps1
.\scripts\start-demo.ps1
node scripts/verify-live.mjs
node scripts/verify-lifecycle.mjs
```

生命周期脚本会验证目标容器的 Compose 标签与 runtime 挂载，只切换 A Text 的 SIGUSR2，并在 finally 检查恢复。应在演示会话空闲时运行。

独立 observer 命令见 windows-quickstart.md。实时报告保存在已忽略的 artifacts/ 中；部分报告含实验 IP/随机 hostname，公开前再次按用途脱敏。token、私钥、用户云凭据和 marker 正文不进入报告。

## 本机运行状态

服务端保持三容器、四项服务运行。Harness 插件已安装并停留在发现页面；临时模型连接已断开，原默认模型已恢复。trustFile 和接口地址指向本次实验配置；安装前的相关配置备份位于 .runtime/current/client/install-backup/。

停止服务使用 scripts/stop-demo.ps1；该命令不卸载 Harness 插件、不清理用户配置、不删除实验凭据。
