# 模型与部署规格的演示展示

服务列表采用真实公开模型的名称，搭配模拟的本地部署规格。本 Demo 没有下载模型权重，也没有运行这些模型或量化引擎；接口响应继续标明 Mock。插件列表不再将 Mock 作为每项的首要状态，服务明确声明 `mock: true` 后，其展开详情显示模拟性质说明。

初始列表仅显示名称、地址、已知规格及特殊能力、key 状态。点击服务行后再展开检查、连接、输入 key 和协议信息，一次只展开一项。已注册插件路由的服务显示“已接入”；普通候选没有统一的“已发现”标签。`mock` 缺失或为 false 不证明后端正在运行真实模型，因此不会生成“真实服务”或“非 Mock”标签。普通部署与 Demo 使用同一套交互。

| 节点 / 部署位置示例 | 展示型号 | 标称规模 | 量化 / 精度 | 版本 | 特殊能力标签 | API Key |
|---|---|---|---|---|---|---|
| A / Studio Workstation | DeepSeek-R1-Distill-Qwen-32B | 32B | Q4_K_M | R1 | 无 | 不需要 |
| A / Studio Workstation | Qwen2.5-VL-7B-Instruct | 7B | BF16 | 2.5-VL | 图像 | 尚未填写 |
| B / `192.0.2.51` | GLM-4-9B-Chat | 9B | INT4 | 4 | 工具调用 | 已保存 |

## 「公司到家」展示 profile

像连接 Wi-Fi 后寻找所在网络的打印机一样，用户离开公司、回到家中，希望客户端重新发现当前环境提供的 LLM 服务。服务名称带上场景和具体型号，方便观众区分两边的资源；重新发现后仍需独立授权和显式接入，不能因名称相近就继承另一环境的凭据。

新 runtime 可选择 `--scene company` 或 `--scene home`。不传该参数时，保持上面的标准三服务演示。profile 仅配置展示信息与初始启用状态，不改变 Mock API 的技术模型 ID、路径或认证方式，也不下载或运行对应的模型权重。

| 场景 | 列表展示名称 | 标称规模 | 版本 | 量化 / 精度 | 技术模型 ID | 初始启用 / 认证 |
|---|---|---|---|---|---|---|
| 公司 | 公司·DeepSeek-R1-Distill-Qwen-32B | 32B | R1 | Q4_K_M | `mock-text` | 是 / 无需 Key |
| 公司 | 公司·Qwen2.5-VL-7B-Instruct | 7B | 2.5-VL | BF16 | `mock-vision` | 是 / 需要独立 Key |
| 公司 | 公司·GLM-4-9B-Chat | 9B | 4 | INT4 | `mock-tools` | 是 / 需要独立 Key |
| 家庭 | 家庭·Qwen3-8B | 8B | 3 | Q8_0 | `mock-text` | 是 / 无需 Key |

家庭 profile 将 `a-text` 的展示信息切换为 Qwen3-8B，继续使用 `/text/v1` 和 `mock-text`。`a-vision`、`b-tools` 的配置和独立凭据仍保留，但初始禁用、不广播，通过认证后的 API 请求返回不可用；家庭服务列表只有上述一项。两个原生节点进程仍由同一个控制器管理。Q8_0 同样只是模拟部署规格，不能据此推断真实量化效果或性能。

先用 `doctor` 确认服务所在网络的实际 IPv4。下面使用文档示例地址，运行前须替换为本机在各网络上的实际地址：

```sh
node packages/lab-controller/cli.mjs doctor

# 公司网络：创建并运行公司 profile；按 Ctrl+C 停止所属节点。
node packages/lab-controller/cli.mjs native run --scene company --runtime .runtime/company --interface 192.0.2.10

# 手动切换到家庭网络后，再用当前地址运行家庭 profile。
node packages/lab-controller/cli.mjs native run --scene home --runtime .runtime/home --interface 198.51.100.20
```

如只需生成配置，使用 `init --scene company --runtime .runtime/company --address 192.0.2.10 --interface 192.0.2.10`，家庭同理。两个 profile 默认占用相同的 HTTPS 端口，不能在同一台机器上同时启动；上述命令不会替用户切换 Wi-Fi，也不会自动建立客户端信任。应分别使用新目录内的 `client/trust.json` 配置信任，并由用户决定接入哪个服务。修改显示名称不构成授权，客户端不会从 presenter 文件自动导入 Key。

profile 在初始化时固定。复用已有目录时可以省略 `--scene`，或指定相同场景；指定不同场景会被拒绝，要求选择新目录。相同地址下的复用不会重写配置、Key、证书、marker 或 `runId`。在新目录创建家庭 profile 会生成独立的身份材料，不会把公司凭据复制过来。原有默认 runtime 也不会因新增 profile 自动改名。

脚本可复用 `packages/lab-controller/scene-profile.mjs` 的 `servicesForScene(nodeId, scene)` 获取服务配置；它返回新的对象，不修改默认模型定义或运行中的实例。受控场景演示与真实物理切网验收应分别标注，不能仅凭换了 profile 就声称验证了自动切网发现。

## 展示字段与信任边界

部署位置使用友好名称与实际 IP：A 的两个服务显示同一名称 Studio Workstation；B 使用本次部署的实际 IP。展开协议与地址，可看到各服务实际使用的 `llm-<runId>-a.local` 或 `llm-<runId>-b.local` 主机名。标准场景表中的 IP 是脱敏后的文档示例，实际值读取运行配置；`<runId>` 随部署生成，不是固定地址。轻量模式中的两个容器共享一个 WSL IP，服务由端口和路径区分。位置栏的 IP 显示不改变 HTTPS 连接使用的主机名或 TLS 身份验证。

名称及型号规模依据发布者的模型卡：[DeepSeek R1 Distill Qwen 32B](https://huggingface.co/deepseek-ai/DeepSeek-R1-Distill-Qwen-32B)、[Qwen2.5-VL-7B-Instruct](https://huggingface.co/Qwen/Qwen2.5-VL-7B-Instruct)、[GLM-4-9B-Chat](https://huggingface.co/zai-org/glm-4-9b-chat)。参数量采用型号标称值，不作为精确权重计数。

量化 / 精度是本 Demo 选择的模拟部署配置，不表示发布者提供了对应量化包，也不表示已经测试其质量或硬件占用。BF16 是浮点精度；Q4_K_M、INT4 是量化配置名称。这里的“版本”指模型系列版本，与 DNS-SD 公告里的 API 协议版本不同。

列表不为所有服务显示“文本输入”或“流式响应”标签；没有特殊能力的服务保持简洁。图像和工具标签依据通过本地信任与认证策略后取得的接口能力，表示本次模拟接口提供的功能子集，不代表对应真实模型的全部能力。需要 Key 的服务在使用输入或保存的 key 检查成功前保持能力待确认；服务端对未授权的模型、能力和推理请求均返回 401。展开后仍可查看非流式、不兼容等阻止接入的信息。

“无需 API key / 已保存 / 尚未填写”是认证及客户端凭据状态，不是模型能力。DNS-SD 中的 `auth=none|required` 只作为网络提示，本地 `trust.json` 独立指定对应策略并固定 TLS 身份和允许地址。免 Key 的 DeepSeek 不附带 Authorization；另两个服务使用各自的 Key，不能互换。免 Key 也继续验证证书、主机名和指纹。

显示名称、参数量、版本和量化 / 精度通过实验能力接口返回，不加入发现草案的 TXT 标准字段。`display_name` 与 `deployment` 是可选展示元数据；请求继续使用稳定的 `mock-text`、`mock-vision`、`mock-tools` 模型 ID，旧脚本和已验证的响应协议保持兼容。Harness 模型菜单使用展示名称。

已有 runtime 的默认展示值由服务启动时兼容映射到新版；自定义配置优先。旧四服务 runtime 在 Harness 完全退出、该 runtime 的服务停止后显式执行 `node packages/lab-controller/cli.mjs migrate-three-state-demo --runtime .runtime/current`，再启动服务；使用其他 runtime 时替换为实际目录。迁移保留 Key、证书、marker 和 runId，移除 C 的配置与授权、解除旧 tokenFile 引用。演示前展开 GLM 保存一次 key，Vision 保持未配置，步骤见 [API key 演示](api-key-demo.md)。已保存 key 不自动等于已检查能力、当前 key 仍有效或服务可达。

这些 Demo Key 只在本地 Mock 中有效，不是真实模型厂商凭据。插件不会自动加载 presenter 文件；它不进入服务端卷或公开证据包，整个 `.runtime/` 已被 Git 忽略。需要 Key 的 Tools 服务仍使用服务端内部 HMAC 签名校验函数调用关联，该签名密钥独立于客户端 API Key。
