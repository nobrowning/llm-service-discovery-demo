# 验证报告

更新日期：2026-11-03。当前 Demo 0.6.0 随附 core/公告器 0.3.1、插件 0.5.1，支持原生两个进程或 Windows/WSL 两容器，共三项服务。各版本的实测范围分别记录；历史结果不替代当前版本验收。

## 0.6.0 跨平台验证

真实 Mac 通过同局域网 SSH 连接，复用用户现有受信主机记录与密钥，在独立用户目录解压官方 Node 24.22.2 arm64（核对官方 SHA-256），没有安装全局 npm 包或改动系统证书。Mac 系统命令返回 macOS 27.2 / Darwin 27.2.0，架构 arm64。Linux 为现有 Ubuntu WSL 的 x64 环境，使用独立目录中的 Node 24.22.2；这不等于独立物理 Linux 主机验收。

| 检查 | 实际结果 |
|---|---|
| core / advertiser / plugin 源码、打包和安装 | Windows、Mac arm64、Linux x64：14 / 20 / 49 项组件测试通过；公告器和插件最终 tgz 空缓存离线安装通过 |
| 五类平台 CI | Windows x64、Linux x64/arm64、macOS arm64/Intel；断言真实 OS/架构。core/公告器另在 Linux x64 验证 Node 22 下限 |
| Demo 自动测试 | Windows 56/56；Mac/Linux 准备包 53 通过、1 项跳过（没有 PowerShell 的打包子测试）；核心原生/协议测试均执行 |
| Windows 原生 Node | 真实 mDNS/HTTPS/Responses 24/24；生命周期 7/7，3→2→3 |
| Mac arm64 原生 Node | 真实 mDNS/HTTPS/Responses 24/24；生命周期 7/7，3→2→3；系统 mDNSResponder 同时运行 |
| Linux x64 原生 Node | 24/24、生命周期 7/7；停止后同 runtime 重启，凭据与信任保持不变；私密文件权限 0600 |
| Windows 客户端 → Mac 服务端 | 两台物理机器同局域网，真实发现、独立 TLS 信任和 API 调用 24/24 |
| Mac 客户端 → Windows 服务端 | 反向跨设备发现及 API 调用 24/24 |
| 独立 Bonjour 观察 | Mac 系统 `/usr/bin/dns-sd` 观察到 3/3 服务，没有使用项目发现库 |
| ZIP 平台兼容 | 修复 Windows PowerShell 5.1 的 ZIP 反斜杠条目；统一使用正斜杠，Mac 解压及 266 个准备包文件校验通过 |

24 项检查覆盖免 key、缺失/错误/跨服务 key 拒绝、受信 TLS、模型/能力、流式/非流式文本、图像字节传输与工具结果关联。工具执行器是独立验证脚本，**不是 Harness 原生工具运行时**。跨设备验证只传递客户端实验信任及专门的合成测试 key，没有复制服务端私钥。停止与恢复由实例绑定的回环控制完成，不按磁盘中的任意 PID 杀进程。

Linux 测试暂时停止原项目的两个 WSL 容器，结束后恢复同一容器 ID；未替换其旧运行凭据。Mac/Linux 的组件安装验证与 Demo 实跑分别记录。发布工作流在最终 tag 生成新资产，下载校验后才公开，最终附件的验收结果记录在 Release 说明中。

仍未声称完成：Mac 上 Harness 图形界面的文本/图像/工具会话，Linux Web Host 的 UI/凭据/重启行为，Linux 独立物理网络与 Avahi 共存，macOS Intel/Linux ARM64 实体硬件，Windows ARM64，Mac Docker Desktop 组播或多架构预构建镜像。CI 包验证不能替代这些实机/界面验收。

## 0.5.1 Release 部署验证

Demo 0.5.1 增加 Windows/WSL 部署 ZIP，内含运行依赖、插件及预构建镜像。镜像清单绑定包版本、镜像 tag、Docker image ID 和归档 SHA-256；启动前拒绝缺包、路径越界、链接及损坏归档，部署路线不构建镜像、不要求 Docker Desktop 或 Node 基础镜像。首次缺少 Docker static/Compose 时仍需联网下载。

发行准备包解压到新的本机目录后，257 个文件校验值、组件包校验和 **42/42** Demo 测试通过。使用 Windows PowerShell 5.1 启动，实际加载发行镜像并生成新 runtime；三个服务由容器公告，真实网络检查 **24/24**、生命周期 **7/7**（3→2→3）通过。随后恢复原 Demo runtime，原信任文件与 key 保留。准备期间发现 PS5.1 把管道中的 JSON 数组包装为单一对象导致计数误报，已修复，并纳入回归。

Windows PowerShell 5.1 与 PowerShell 7 的启动器回归均 **30/30**，覆盖实际 JSON 数组计数、损坏镜像、路径/版本/tag 错误、加载后 image ID 不符及源码路线。测试位于 `tests/deployment/release-launcher.test.ps1`，不操作真实服务；Windows CI 会执行。

四仓的 Release workflow 构建并测试后生成草稿，下载最终 GitHub 附件、校验并进行安装/启动验收后才发布。组件最终附件以 Linux CI 产物为准：Windows 打包与 Linux 打包可能仅有 tar 可执行权限差异，不能直接把压缩包哈希差异判定为源码差异。发行包不携带本机 runtime、证书、API key 或 Harness profile。

此轮是同一台 Windows 机器上的独立解压目录与真实网络验证；未宣称第二台机器、全新 WSL 安装、完全离线安装或新的原生 Harness 图像/工具 UI 验收。插件 0.5.0 的已完成原生 UI 范围见下一节；最终 Release 下载验收结果记录于对应 GitHub Release 说明。

## 0.5.0 服务列表交互验收

插件初始只显示服务名称、地址、已知规格与能力、凭据状态。选择条目才展开检查、连接、密码和凭据管理操作，同一时间只展开一项。展开本身不请求 API 或更改模型。普通服务不再显示 Mock/已发现角标；已注册的服务路由显示“已接入”，只有明确声明 `mock: true` 的能力响应在展开详情显示模拟说明，缺少声明不推断为真实模型。

插件 **48/48**、Demo **42/42** 测试通过。新增覆盖初始无输入/操作表单、选择不调用 API、单项展开、收起/切换/Escape 清除未提交 key、候选撤回后清理且不自动重开、真实/未知/模拟服务展示差异，以及屏幕阅读器可区分相同模型的不同主机并读出连接状态。Demo 从最终 tarball 离线重装依赖并通过组件哈希/版本检查。

在 Harness rc.5 安装 0.5.0 后，已安装 `client.js` 与源码 SHA-256 相同。原生界面初始三条服务均收起，GLM 先前保存的 key 保留；点击 Qwen 后出现密码与记住选项。输入未提交的合成测试文本后按 Escape 收起，再用 Enter 展开时输入框为空。切换到 GLM 后只有该条展开，直接使用保存的 key 连接，原生新会话成功选择 GLM 模型。返回列表时仅 GLM 显示已接入，模拟说明只在展开 GLM 详情后出现；断开后恢复原默认模型。

本轮仅修改前端与相关文档、安装包，不更改服务端或协议；继续使用容器镜像 0.4.0、核心库及公告器 0.3.0。网络和推理能力的既有证据见下方对应版本记录，本轮不重复宣称原生图像或工具回合验收。

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

## 早期本机运行状态（历史）

服务端保持三容器、四项服务运行。Harness 插件已安装并停留在发现页面；临时模型连接已断开，原默认模型已恢复。trustFile 和接口地址指向本次实验配置；安装前的相关配置备份位于 .runtime/current/client/install-backup/。

停止服务使用 scripts/stop-demo.ps1；该命令不卸载 Harness 插件、不清理用户配置、不删除实验凭据。
