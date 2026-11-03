# 协议映射、实验扩展与实现边界

适用版本：本仓库 v0.4.0 演示实现；核对日期：2026-11-03。基础发现对照 [draft-cui-dawn-local-llm-api-discovery-00](https://datatracker.ietf.org/doc/draft-cui-dawn-local-llm-api-discovery/)。该文档仍是 Internet-Draft；本项目不代表 IETF 已采纳或认证。

本文区分草案的线协议、本项目的部署选择以及已实现功能。设计目标、单元测试通过和真实 Desktop 验收是不同证据；请同时保留具体版本、测试输出与现场记录。

## 1. 节点、服务、模型和能力

本项目的节点是部署单元，服务是可被发现的 API 入口，模型是请求中的 `model` 标识，能力则描述该模型在该入口上的输入、输出与调用约定。

| 部署节点 | DNS-SD 服务 | API base | 模型 |
| --- | --- | --- | --- |
| A | Node A Text，附带本次 run ID | `/text/v1` | `mock-text` |
| A | Node A Vision，附带本次 run ID | `/vision/v1` | `mock-vision` |
| B | Node B Tools，附带本次 run ID | `/v1` | `mock-tools` |

A 的两个入口拥有独立模型白名单、凭据和可用状态。它们可以共享主机与端口，但不能按 IP 去重。默认每个入口只暴露一个模型，避免把不同模型的能力并集误称为某个模型同时支持全部能力。

当前 Windows 快速路线在已有 Ubuntu WSL 内运行独立 Docker daemon，两个容器使用该 daemon 的 host network。容器分别运行自己的 API 和公告器；两个逻辑节点共享 Ubuntu 的 IP，以端口和路径区分服务。这不是两个独立 LAN IP，也不证明 Docker Desktop 普通 bridge 能转发 mDNS。实际网络试验见 [network-spike.md](network-spike.md)，部署步骤见 [windows-quickstart.md](windows-quickstart.md)。

## 2. 基础发现线协议

草案定义服务实例的 PTR、SRV、TXT 和 A/AAAA 组合，并给出以下 TXT 参数。`_llm-api._tcp` 是草案提出的服务类型，本项目不宣称其已完成 IANA 注册。[草案 §§5、9](https://datatracker.ietf.org/doc/draft-cui-dawn-local-llm-api-discovery/)

| 信息 | 本项目的发布/解析规则 |
| --- | --- |
| Browse name | `_llm-api._tcp.local.`；内部比较忽略大小写和末尾点 |
| PTR | 枚举实例；缺少对应 PTR 时，不仅凭 SRV/TXT 生成候选 |
| SRV | 提供目标 hostname 与端口；实例名不充当地址或可信身份 |
| TXT `txtvers` | 必填，当前只接受 `1`，发布时放在首项 |
| TXT `api` | 必填，当前只接入 `openresponses` |
| TXT `protovers` | 本绑定使用 `2026-04-24`；其他版本不按当前绑定执行 |
| TXT `scheme` | 解析 `http`/`https`；插件的实验接入策略仅接受 HTTPS |
| TXT `base` | 从广告读取，例如 `/text/v1`；不固定补 `/v1` |
| TXT `auth` | 逐服务发布 `required` 或 `none`；后者是对草案 -00 Open Responses 绑定的实验扩展，不提供凭据 |
| A/AAAA | 提供地址候选；接入还要经过独立允许地址范围的校验 |

主机、端口、密钥、提示词和完整模型目录不放进 TXT。未知 TXT key 被忽略；不支持的版本/profile 或非法路径不能生成可接入配置。TXT key 比较不区分大小写，同名 key 按第一个值处理。实现还采取保守路径策略，拒绝编码后的遍历段、编码分隔符和异常 URL 组成部分。

例如本次广告的目标为 `llm-<run>-a.local`、端口 `18443`、`base=/text/v1`，则候选为：

```text
https://llm-<run>-a.local:18443/text/v1
POST /text/v1/responses
```

`responses` 是当前 profile 的操作路径；`models` 和 `_demo/capabilities` 是本项目接入流程另外使用的接口。不能从这些接口的存在推导出其他服务也支持它们。

主要实现已迁至独立 core 与公告器仓库，Demo 通过版本化安装包引用。见 [仓库与依赖](repositories.md)。

## 3. 发现到 Harness 接入

```text
节点部署配置 → 节点公告器 → mDNS/DNS-SD → Harness 发现候选
                                             ↓
                              独立信任策略与 TLS 身份检查
                                             ↓
                         获取 models 和实验 capabilities
                                             ↓
                               注册 Harness API adapter
                                             ↓
                       新会话 → 直接 HTTPS → 所选 API 服务
```

草案把候选配置交接与后续 API 调用分开，并要求独立授权、生命周期处理与服务身份验证；它不负责发放密钥、选择模型或规定 Harness 配置格式。[草案 §§6、8](https://datatracker.ietf.org/doc/draft-cui-dawn-local-llm-api-discovery/)

本实现中：

1. 发现组件只从网络记录建立列表。部署 JSON 和信任文件都不能独自生成候选。
2. 显式点击“检查服务”或“连接并新建会话”后，插件验证候选和实验信任，再读取认证后的元数据；单纯发现不发送推理请求。
3. 插件使用 Desktop 0.2.1-rc.3 的 `ctx.llm.registerAdapter` 注册自己的 Responses adapter。它没有把任意广告直接写入内置 pi-ai provider。
4. adapter 的独立 HTTPS agent 将连接固定到获准的已发现地址，同时保留广告 hostname 的 HTTP Host、TLS SNI 和证书名称验证。这不要求全局覆盖系统 DNS，也不关闭 TLS 校验。
5. endpoint、证书、地址与本地认证策略绑定构成不可变 provider 身份；既有会话不会因新候选出现而自动改走其他服务。模型默认值通过 Harness 的带版本设置接口有条件地修改。
6. “断开并恢复默认模型”清理插件创建的运行时路由，且只在默认项仍是插件最后写入值时恢复原选择。卸载/退出释放发现 socket 和 HTTPS transport。

这是针对已安装 Harness 的应用适配，不是 DNS-SD 协议要求。详细配置及版本边界见 [插件安装](plugin-setup.md)。

### Harness 本地控制接口边界

侧栏使用标准 same-origin `fetch`。Desktop 0.2.1-rc.3 的 shell 通过 `forwardWebRequest` 把 `dsh-app://app` 请求转发到认证后的 Host，认证 cookie 由 shell 保管，不暴露给 renderer；不依赖私有全局 transport hook。Host 在 `ctx.connection.fetch` 的共享 registry 中注册八条精确路径：`GET /api/lan-discovery/state`，以及 `POST /api/lan-discovery/{start,stop,inspect,connect,disconnect,credential,forget-credential}`。它们用于控制发现和本地接入，不转发模型推理请求。

Desktop 0.2.1-rc.3 的共享 registry 在调用精确路由前要求已建立 Peer 的 `principal.kind` 为 `owner`；HTTP 载体先经过 Harness 的 Host/Origin 与认证检查。插件依赖这套原生准入，不自行获取或复制认证 cookie。精确路由 registry 不可用时注册失败，不另开未经鉴权的 HTTP 入口。该行为依赖此版本 Harness 的已核对实现，升级后需要重新验证。修改本地链接的 Host 或浏览器代码后，需要完全退出并重开 Desktop，以同时重载两端代码。

控制请求按 JSON 对象读取，插件处理上限为 8 KiB；未知字段直接拒绝。检查/连接要求非空字符串候选 ID，连接另允许非空字符串模型 ID，单字段最长 1024 字符；开始、停止、断开只接受空对象。controller 再确认候选仍存在于当前发现结果，模型来自经认证取得的该服务目录。请求不能提供目标 URL、凭据文件、信任文件或 marker 路径；这些只来自本地插件配置和独立信任文件。共享载体使用 buffered body，因此 8 KiB 是插件处理门槛，不代表载体在读入任何数据前就执行相同门槛。

控制边界与载体回归测试不替代实际 Desktop 会话验收。文本、图像、工具、断开恢复及凭据保存分别按版本记录，实际结果见 [验证报告](validation-report.md)；不能把历史四服务版本的通过结论当作新版验收。

## 4. 独立实验信任与凭据

初始化脚本在本地生成实验 CA、服务证书和每服务 token。客户端 `trust.json` 分别限定准确 base URL、允许 IP、叶证书 SHA-256 与独立认证策略；同一个证书可以覆盖多个实验 hostname，但路径/端口对应的凭据仍分别管理。0.4.0 默认为三个服务：DeepSeek 免 key、GLM 在演示准备时保存 key、Qwen-VL 尚未输入。已保存是客户端状态，DNS-SD 仍只发布 auth=required/none。详见 [API key 演示](api-key-demo.md)。

| 检查 | 实现行为 |
| --- | --- |
| 候选是否经过独立授权 | 准确 URL 必须存在于本地信任文件，已发现地址必须与获准地址有交集 |
| 对端身份 | 验证实验 CA 链、hostname 与叶证书指纹 |
| DNS 地址与证书 hostname | 连接到经过允许范围检查的地址，保留原 hostname 验证 |
| 密钥来源 | 用户在密码框输入并验证，可通过 Harness 官方 credentials 服务记住或仅本次使用；兼容可选 tokenFile；广告不能指定凭据来源 |
| 跳转 | 拒绝 HTTP redirect，不跨目的地转发 token |
| 全局环境 | 不安装系统全局 CA，不设置 `NODE_TLS_REJECT_UNAUTHORIZED=0`，不复用云 API key |

TLS 认证的是 API 连接；它不为此前的 mDNS 报文提供签名。显示名称、`auth=none` 或“发现成功”都不是信任来源。实验信任初始化是演示部署的一部分，不是本项目声称已经解决的通用零配置信任协议。

`.runtime/` 属于本机运行状态，不应提交或发布。服务容器只挂载 `server/`，不挂载客户端 `marker.txt` 或客户端插件状态。日志默认只记录 request ID、服务、模型、输入类型、状态与耗时，不能借日志回显 token、提示词或 marker 原文。

协议单元测试可显式开启仅隔离测试使用的明文 HTTP。这个 escape hatch 不属于可携带凭据的正式演示部署。生产服务的信任分发、证书轮换、凭据签发及组织授权仍需另行设计。

实现：[initialize.mjs](../packages/lab-controller/initialize.mjs) 与独立插件仓库的 `trust.mjs`。

## 5. 实验能力接口

`GET {base}/_demo/capabilities` 是本项目应用层扩展，Schema 为 `llm-discovery-demo-capabilities/v1`；不是草案 -00 的新增 TXT，也不是某个已注册的标准 well-known URL。[JSON Schema](../schemas/capabilities.v1.schema.json)

| 字段 | 含义与边界 |
| --- | --- |
| `mock` | 服务自报实现为模拟器；本部署三服务都为 Mock |
| `demo_node_label` | 展示分组，不是设备身份或授权依据 |
| `models[].id` | 对应请求中的 model；需与该服务 `/models` 列表交叉检查 |
| `input_modalities` / `output_modalities` | 输入/输出维度；图片输入不等于图片生成 |
| `streaming` | 是否声明支持 SSE；普通 JSON 响应不等于 JSON mode |
| `function_calling` | 是否声明可以返回结构化函数调用；不代表服务执行工具 |
| `structured_output` | JSON/Schema 输出约束，当前 Mock 明确不支持 |
| `server_tools` | 服务端工具清单；当前为空，不提供联网搜索 |
| `cache_max_age_seconds` | 服务声明的缓存建议，当前值为 30 |

支持状态使用 `supported / unsupported / unknown`；缺失字段不能当成支持。认证后读取到的能力仍是服务声明，不是逐项运行验证。内部 `details.status=verified` 表示完成连接身份检查和元数据读取；请勿将其解释为视觉或函数调用已经通过实测。

**当前实现限制：**插件在显式 inspect/connect 时重读元数据，并在发现变更时丢弃旧详情；尚未实现按 30 秒提示自动过期和重读。当前 transport 使用通用的 20 秒超时、16 MiB 大小上限，而不是能力专用 2 秒/64 KiB 门槛。元数据读取失败不会删除网络候选，但当前 adapter 会阻止缺少必要模型/流式声明的接入。以上均不能包装成已实现的生产能力目录协议。

## 6. 工具、视觉、搜索和 Agent 的边界

- Text/Basic 返回含节点、服务标记的确定性文本。模型 token usage 是明确标记的字符数估计。
- Vision 接受内联图片，检查容器头、计算实际传输字节的 SHA-256，部分格式报告尺寸。它不理解图像内容，也不自动抓取外部图片 URL。
- Tools 只生成固定 `demo_read_marker`、空参数对象和 call ID。真实 Harness 工具读取客户端 marker 后回传；Mock 检查前序调用与 ID，再返回收到的结果。服务端没有 marker 文件，不能预先伪造该结果。
- 服务端不做自主规划、外部工具执行或 Agent 循环。Harness 本身可以执行客户端工具，但这不改变被发现对象仍是 LLM API 的定位。
- `function_calling` 不等于 `web_search`；前者描述调用结构，后者需要特定搜索工具、执行位置、网络和授权条件。当前演示不提供真实搜索，也不把“容器可出公网”当成搜索能力。作为对照，Ollama 官方搜索示例明确由应用执行单独的搜索 API。[官方搜索说明](https://docs.ollama.com/capabilities/web-search)

Open Responses 以 item、工具调用及语义事件描述交互；本项目只实现实际演示所需的子集。[Open Responses 2026-04-24](https://www.openresponses.org/specification/2026-04-24)

当前 Harness 会把部分宿主生成的上下文作为 `role=user` 消息追加。适配器仅按已核对 Desktop 0.2.1-rc.3 的以下精确 `source.kind` / `source.form` 组合标记非空纯文本 user 消息，并保留原角色和全部文本：

| `source.kind` | `source.form` | 宿主上下文 |
| --- | --- | --- |
| `time-context` | `snapshot` | 时钟快照 |
| `skill-catalog` | `catalog` | 技能目录及目录更新 |
| `agent-instructions` | `instructions` | 附加指令上下文 |
| `runtime-context` | `snapshot` | Agent loop 在 pre-step 后刷新并提交的运行时快照 |
| `runtime-context` | 无 `form` 字段 | 同一运行时投影器明确的清空分支 |

来源缺失、其他 kind/form 组合以及 `goal`、`schedule`、`user-question`、`skill-invocation` 均不标记。普通用户发送相同文字或 `<system-reminder>` 标签也不会自动变成上下文。索引通过标准请求 `metadata` 字段中的本项目专用 `demo_context_indices` 发送：其值是最终 `input` 数组索引列表的 JSON 字符串。这项语义是 **Mock 演示约定**，不是发现草案或 Open Responses 定义的上下文分类机制。

对安装版 0.2.1-rc.3 的 bundled `agent/pre-step` 与 `createUserMessage` 路径进行了静态核对：`dsh-agent-loop` 的 `RuntimeContextProjection.project()`（安装 bundle 第 331–350 行）生成上述快照及清空消息，`step()`（第 1053–1075 行）在各插件 pre-step 后再次刷新并提交。其他条件性消息包括 `tmux-context/snapshot`、`model-selection/notice`、`plan-mode/notice`、`session-reference/recall`、`skill-invocation/instructions`、压缩检查点、重复工具提醒，以及 goal、schedule、subagent、用户批准或问题回答；这些消息保留原有回合语义，不因来自插件而自动加入白名单。运行时注册的 cwd、文件策略等上下文片段已由整体 `runtime-context` 标记覆盖，不检查其中正文。

适配器同时在 Host 的 `lan-discovery request` 日志及既有认证 state 路由的 `lastRequestDiagnostics` 中提供脱敏请求结构：最多最近 128 条消息的 role、source.kind/source.form，以及实际发出的工具名。诊断只复制这些字段且限制标识符格式，不包括正文、路径、context sections、附件、工具参数或返回值、session ID、token，也不写入恢复 journal；它用于核对实际 Host producer 和工具是否暴露。

Mock 要求该附注不超过 512 字节、最多 64 个不重复且范围有效的整数索引，并且每个索引只能指向纯文本 user 消息。错误附注显式返回 `invalid_demo_context`。为兼容早期仅处理时钟的客户端，旧字段 `demo_time_context_indices` 可单独使用；新旧字段同时出现则拒绝。标注仅影响确定性文本回显、工具触发及“是否有新用户回合”的判定；所有输入仍正常校验，工具结果仍须通过原 `call_id` 关联和签名检查。附注不会提供文件路径、访问授权或工具权限，也不进入日志。这让真正的用户输入和工具结果不会被宿主上下文覆盖，同时保留完整请求内容。

三个默认服务支持流式与非流式。保留的独立 C 测试夹具（不在默认 Compose 中）的 `MOCK_NONSTREAM_ONLY=true` 场景会声明并强制 `stream=false`；当前 Harness adapter 需要 SSE，因此该服务可以被发现、直接非流式调用，却不能在这个 adapter 中接入。当前没有非流式客户端 fallback，也没有推理代理。

未实现的 API 功能包括 stateful continuation、`previous_response_id`、持久化 responses、后台任务、JSON Schema 输出、音视频、任意服务端工具和远程图片抓取。完整合同见 [Mock README](../packages/mock-api/README.md)。

## 7. mDNS 生命周期与证据范围

当前实现包含启动 probe、同时 probe 仲裁、两次启动公告、查询应答、known-answer suppression、TTL、cache-flush 的一秒保护、goodbye，以及单服务独立撤销。网络接口变化会清除候选并重建 membership；Windows socket 绑定 `0.0.0.0`，组播接口单独选择。当前实际 transport 是单接口 IPv4；能解析 AAAA 不等于已完成 IPv6 组播验收。

公告名称冲突时不会擅自替换为一个仍沿用旧信任的名称；启动冲突失败，已公告记录先防御，持续冲突停止。重新启用服务时重新 probe。正常撤销和进程异常退出不同：后者可能依赖 TTL 过期，不能承诺立即移除。

这些代码和测试覆盖了选定行为，不构成完整 [RFC 6762](https://www.rfc-editor.org/rfc/rfc6762) / [RFC 6763](https://www.rfc-editor.org/rfc/rfc6763) 一致性或独立互操作认证。查询调度、多网卡/IPv6、冲突恢复与长期网络行为仍需进一步测试；API 子集测试也不是整个 Open Responses 的认证。

复核入口：

```powershell
node --test tests/protocol/*.test.mjs tests/api/*.test.mjs
npm test
node node_modules/dsh-lan-discovery/verify.mjs
```

单元测试证据、Windows 原生 Harness 实际调用、独立 DNS-SD observer 和 OS 级 pcap 应分别记录。应用层收到的原始 datagram JSONL 不自动等同于 pcap；固定地址 HTTP 成功不自动等同于按发现记录接入成功。

## API key 与草案边界

草案 -00 §5.2 支持通用 `auth=none|required` 提示，但 §5.3 要求 Open Responses 绑定使用 `required`。本 Demo 有意将免 key 模式作为实验扩展；解析结果以 `draftAuthCompatible:false` 与 warning 标记，不宣称该模式符合此绑定。插件要求公告与本地信任策略一致，免 key 服务仍须通过同样的 TLS 校验。

owner-only `credential` 请求接受 candidateId、apiKey 和可选布尔 remember；API 省略 remember 时默认为 false，具备保存支持的界面默认勾选。验证成功后才保留，选择记住时通过 Harness 官方 credentials 服务持久化。当前默认 provider 使用本地未加密 YAML，不是操作系统加密保险库；仅本次使用的 key 在退出或重载后清空。保存项绑定精确端点、证书指纹、获准地址和认证策略，不能按显示名跨身份复用。`forget-credential` 按插件拥有的身份清除会话/持久化项及路由，即使已离线也可撤销。状态、journal 与错误不回传 key；请求体字段校验和 8 KiB 上限保留，错误不回显输入或上游 JSON。
