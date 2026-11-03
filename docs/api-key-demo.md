# API key 演示

| 服务 | 认证 | 操作 |
|---|---|---|
| DeepSeek-R1-Distill-Qwen-32B | 免 API key | 直接连接并新建会话 |
| Qwen2.5-VL-7B-Instruct | 需要 API key | 输入对应 key，验证并连接 |
| GLM-4-9B-Chat | 需要 API key | 输入对应 key，验证并连接 |
| Qwen3-8B | 免 API key | 直接连接并新建会话 |

A 节点上的 DeepSeek 和 Qwen-VL 共享主机与端口，但使用不同 API 路径和认证策略；GLM 的 key 不能用于 Qwen-VL。认证状态单独展示，不作为模型能力标签。

## 启动与旧环境更新

新环境使用正常的 `scripts/start-demo.ps1` 初始化。安装 `vendor/dsh-lan-discovery-0.3.1.tgz`，详见 [插件安装](plugin-setup.md)。

如果此前运行过 0.2.0，先完全退出 Harness，再执行：

```powershell
node packages/lab-controller/cli.mjs migrate-auth-demo --runtime .runtime/current
.\scripts\start-demo.ps1
```

迁移保留 run ID、端点、证书、私钥、原有服务端 key 和 marker，仅设置每服务认证策略并解除客户端预填 key。旧 `client/tokens` 文件保留，但新版 Demo 信任配置不再引用它们。迁移可重复执行。不要在活动会话中修改认证策略。

## 展示顺序

1. 打开 Harness 的局域网服务页。DeepSeek 和 Qwen3 显示“无需 API key”，直接连接其中一个并发出文本请求，看到真实 HTTPS/SSE 的 Mock 响应。
2. 选择 GLM 或 Qwen-VL，输入一个错误的演示 key，点击“验证并连接”。界面报告 key 被拒绝，输入框清空，不改变当前模型。
3. 本地打开 `.runtime/current/presenter/demo-api-keys.txt`，复制该服务对应的演示 key。它们仅用于本机 Mock，不是 DeepSeek、Qwen 或 GLM 厂商凭据。请勿将文件内容放入演示录像、日志或开源材料。
4. 输入正确 key，验证后自动接入并新建会话。发出文本请求；也可以继续原有图像或工具调用演示。
5. 返回服务页，可更换 key 或清除本次输入。清除会断开该服务并按条件恢复此前默认模型；重新连接需再次输入。普通“断开”保留本次运行内已验证的 key。
6. 退出并重新打开 Harness，需 key 服务再次显示输入框；免 key 服务仍可直接接入。此版本不提供跨重启保存。

## 实现边界

公告只包含 `auth=required` / `auth=none` 提示，不包含 key。TLS 的 CA、主机名、指纹、允许 IP、精确端点和认证策略必须通过独立本地信任配置验证；输入 key 不会授权未信任端点，也不会关闭证书验证。插件先验证模型目录和能力接口，成功后才把 key 保存在 Host 内存，使用同一个服务身份进行后续调用。

验证脚本从服务端 fixture 读取演示 key，插件不会读取该文件。脚本的报告不含 key；缺 key、错 key、跨服务 key 和正确 key 均有测试。HTTP 401/403 与无效 JSON 不回显服务响应正文，状态接口与默认模型恢复日志不包含凭据。

草案 -00 §5.2 的通用 `auth` 提示支持两种值，但 §5.3 的 Open Responses 绑定要求 `auth=required`。本 Demo 的免 key Open Responses 模式属于实验扩展，用于展示需求；不宣称符合该绑定。发现、认证策略、发放 key 与模型调用是分别处理的环节。
