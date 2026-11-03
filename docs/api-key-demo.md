# API key 三状态演示（0.5.0）

| 服务 | 初始演示状态 | 操作 |
|---|---|---|
| DeepSeek-R1-Distill-Qwen-32B | 无需 API key | 展开后直接连接并新建会话 |
| GLM-4-9B-Chat | 已保存 API key | 展开后使用已保存的 key 连接 |
| Qwen2.5-VL-7B-Instruct | 尚未填写 API key | 展开后输入对应 key，验证并连接 |

A 节点上的 DeepSeek 和 Qwen-VL 共享主机与端口，但使用不同 API 路径和认证策略；B 节点提供 GLM。GLM 的 key 不能用于 Qwen-VL。认证状态单独展示，不作为模型能力标签。“已保存”是客户端状态，不是公告里的新认证类型。

初始界面仅展示服务信息和凭据状态，点击服务行才出现输入框及接入操作；每次只展开一项。选中不会自动连接，收起或切换服务会清除未提交的密码。“已保存”不证明当前 key 仍有效或服务可达，连接时仍会验证。已注册插件路由的服务显示“已接入”；其他服务不需要统一的“已发现”或“非 Mock”标签。若接口明确声明 `mock: true`，展开详情中显示模拟服务说明。

## 启动与旧环境更新

新环境可按[原生部署](native-quickstart.md)运行 `native run`，或在 Windows/WSL 使用 `scripts/start-demo.ps1`。安装 `vendor/dsh-lan-discovery-0.5.1.tgz`，详见[插件安装](plugin-setup.md)。下文 `.runtime/current` 是 WSL 默认路径；原生路线改为实际选择的 runtime，例如 `.runtime/native`。macOS/Linux 直接在本机文本编辑器查看 presenter 文件，不需要 PowerShell 辅助脚本。

如果此前运行过四服务版本，先断开 LAN 连接并完全退出 Harness，然后执行：

```powershell
node packages/lab-controller/cli.mjs migrate-three-state-demo --runtime .runtime/current
.\scripts\start-demo.ps1
```

迁移保留 run ID、保留服务的端点、证书、私钥、服务端 key 和 marker；移除 C Basic 的配置与信任项，并解除旧 `tokenFile` 引用。旧 key 文件仍保留。启动仅在本项目中清理已经退役的 node-c 容器。迁移可重复执行，但不会替用户保存任何 key；不要在活动会话中迁移。

## 演示前准备已保存的 GLM

1. 在自己的屏幕打开 `.runtime/current/presenter/demo-api-keys.txt`，可使用 `.\scripts\open-demo-api-keys.ps1`。其中 key 仅用于本机 Mock，不是真实模型厂商凭据；文件内容不进入投影、录像或公开材料。
2. 点击 GLM 服务行展开，在密码框粘贴对应 key，保留默认选中的“记住 API key”，点击“验证并连接”。只有通过服务的模型与能力接口验证后才保存。
3. 返回服务页并断开连接。GLM 保持“已保存”，Qwen-VL 保持未配置。若 Vision 已有 key，先展开该服务并清除。
4. 重启 Harness，核对 DeepSeek 无需 key、GLM 已保存、Qwen-VL 待输入。保存不会自动连接，也不会把 key 填回密码框。

这一步模拟用户以前已经配置过 GLM。插件不会自行读取 `presenter/demo-api-keys.txt` 或 `server/tokens.json`；发现服务本身也不会获得 key。

## 展示顺序

1. 展开 DeepSeek 并连接，发送文本并收到真实 HTTPS/SSE 的 Mock 响应；请求不带 Authorization。
2. 展开 GLM 并连接，无需再次输入。可继续演示函数调用和客户端工具回传。
3. 展开 Qwen-VL，输入一个错误的演示 key，确认被拒绝、密码框清空，并可重试；再输入它自己的正确 key，验证后接入并发送图片。
4. 演示“记住 API key”：选中时重启后仍可连接；取消时仅本次 Harness 运行有效。保存后的值不返回页面。
5. 更换 key 先验证新值；错误替换不覆盖原来可用的 key。“清除”移除该服务在插件中的已保存凭据、会话凭据和路由，并在适用时恢复默认模型。普通“断开”保留已保存 key。
6. 展示结束后清除 Qwen-VL，保留 GLM 已保存，回到三状态初始布局。

## 保存方式和范围

插件通过 Harness 官方 `credentials` 服务保存 key，不自行往设置、发现缓存或恢复 journal 写明文。当前 Harness 默认凭据 provider 使用本机 profile 中的未加密 YAML；这不是操作系统加密保险库。不希望落盘时取消“记住 API key”。不要分享整个 Harness profile。

每个保存项绑定精确 API base URL、证书指纹、允许地址和认证策略。相同显示名、同一 IP 或同一证书均不足以共享 key；身份变化后不会把旧 key 发送到新目标。清除仅影响该插件拥有的对应服务项，不删除用户的其他 provider 凭据。

公告只包含 `auth=required` / `auth=none`，不含 key 或“已保存”状态。TLS 的 CA、主机名、指纹、允许 IP、精确端点和认证策略必须通过独立本地信任配置验证；输入或保存 key 都不会授权未知端点，也不会关闭证书验证。

验证脚本可显式读取服务端合成 fixture；它不代表插件已完成桌面保存操作。脚本报告、状态接口、journal、日志和错误不含 key；HTTP 401/403 与无效 JSON 不回显服务正文。

草案 -00 §5.2 的通用 `auth` 提示支持两种值，但 §5.3 的 Open Responses 绑定要求 `auth=required`。免 key Open Responses 是本 Demo 的实验扩展，不宣称符合该绑定。发现、发放 key、本地保存和模型调用是分别处理的环节。
