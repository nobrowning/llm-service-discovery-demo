# 模型与部署规格的演示展示

服务卡片采用真实公开模型的名称，搭配模拟的本地部署规格。所有接口继续明确标记 **Mock**；本 Demo 没有下载模型权重，也没有运行这些模型或量化引擎。

| 节点 / 部署位置示例 | 展示型号 | 标称规模 | 量化 / 精度 | 版本 | 特殊能力标签 | API Key |
|---|---|---|---|---|---|---|
| A / Studio Workstation | DeepSeek-R1-Distill-Qwen-32B | 32B | Q4_K_M | R1 | 无 | 不需要 |
| A / Studio Workstation | Qwen2.5-VL-7B-Instruct | 7B | BF16 | 2.5-VL | 图像 | 尚未填写 |
| B / `192.0.2.51` | GLM-4-9B-Chat | 9B | INT4 | 4 | 工具调用 | 已保存 |

部署位置使用友好名称与实际 IP：A 的两个服务显示同一名称 Studio Workstation；B 使用本次部署的实际 IP。展开协议与地址，可看到各服务实际使用的 `llm-<runId>-a.local` 或 `llm-<runId>-b.local` 主机名。上表 IP 是脱敏后的文档示例，实际值读取运行配置；`<runId>` 随部署生成，不是固定地址。轻量模式中的两个容器共享一个 WSL IP，服务由端口和路径区分。位置栏的 IP 显示不改变 HTTPS 连接使用的主机名或 TLS 身份验证。

名称及型号规模依据发布者的模型卡：[DeepSeek R1 Distill Qwen 32B](https://huggingface.co/deepseek-ai/DeepSeek-R1-Distill-Qwen-32B)、[Qwen2.5-VL-7B-Instruct](https://huggingface.co/Qwen/Qwen2.5-VL-7B-Instruct)、[GLM-4-9B-Chat](https://huggingface.co/zai-org/glm-4-9b-chat)。参数量采用型号标称值，不作为精确权重计数。

量化 / 精度是本 Demo 选择的模拟部署配置，不表示发布者提供了对应量化包，也不表示已经测试其质量或硬件占用。BF16 是浮点精度；Q4_K_M、INT4 是量化配置名称。这里的“版本”指模型系列版本，与 DNS-SD 公告里的 API 协议版本不同。

卡片不再为所有服务显示“文本输入”或“流式响应”标签；没有特殊能力的服务保持简洁。图像和工具标签依据通过本地信任与认证策略后取得的接口能力，表示本次模拟接口提供的功能子集，不代表对应真实模型的全部能力。需要 Key 的服务在使用输入或保存的 key 检查成功前保持能力待确认；服务端对未授权的模型、能力和推理请求均返回 401。非流式、不兼容等阻止接入的状态仍然显示。

“无需 API key / 已保存 / 尚未填写”是认证及客户端凭据状态，不是模型能力。DNS-SD 中的 `auth=none|required` 只作为网络提示，本地 `trust.json` 独立指定对应策略并固定 TLS 身份和允许地址。免 Key 的 DeepSeek 不附带 Authorization；另两个服务使用各自的 Key，不能互换。免 Key 也继续验证证书、主机名和指纹。

显示名称、参数量、版本和量化 / 精度通过实验能力接口返回，不加入发现草案的 TXT 标准字段。`display_name` 与 `deployment` 是可选展示元数据；请求继续使用稳定的 `mock-text`、`mock-vision`、`mock-tools` 模型 ID，旧脚本和已验证的响应协议保持兼容。Harness 模型菜单使用展示名称。

已有 runtime 的默认展示值由服务启动时兼容映射到新版；自定义配置优先。旧四服务 runtime 在 Harness 退出后显式执行 `node packages/lab-controller/cli.mjs migrate-three-state-demo --runtime .runtime/current`，再重建服务。迁移保留 Key、证书、marker 和 runId，移除 C 的配置与授权、解除旧 tokenFile 引用。演示前在 GLM 卡片保存一次 key，Vision 保持未配置，步骤见 [API key 演示](api-key-demo.md)。已保存 key 不自动等于已检查能力。

这些 Demo Key 只在本地 Mock 中有效，不是真实模型厂商凭据。插件不会自动加载 presenter 文件；它不进入服务端卷或公开证据包，整个 `.runtime/` 已被 Git 忽略。需要 Key 的 Tools 服务仍使用服务端内部 HMAC 签名校验函数调用关联，该签名密钥独立于客户端 API Key。
