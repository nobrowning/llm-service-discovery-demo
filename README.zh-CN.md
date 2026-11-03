# 局域网 LLM API 服务发现 Demo

在现有 DeepSeek Harness 内发现局域网 LLM API，选择服务后一键配置并新建会话。对应 [IETF 草案](https://datatracker.ietf.org/doc/draft-cui-dawn-local-llm-api-discovery/) 的本机可运行实验。

**两容器、三服务、容器自行公告。Windows 只运行客户端。**

| 节点 | 服务 | 能力 |
|---|---|---|
| A | DeepSeek R1 Distill Qwen 32B / Qwen2.5-VL 7B | Q4_K_M / BF16；后者支持图像字节接收和摘要 |
| B | GLM-4-9B-Chat | INT4；函数调用、客户端工具结果回传 |

API 均为 Mock，无需模型、GPU 或云额度。网络发现、HTTPS/认证、SSE、图片传输和工具往返真实执行；不提供真实推理或联网搜索。

紧凑的服务列表只显示图像、工具调用等已知特殊能力；型号、版本及量化 / 精度的展示约定见 [模型展示说明](docs/model-presentation.md)。模拟服务在展开详情中说明其性质，列表不再用统一的 Mock / 非 Mock 标签；普通部署使用同一套界面。

## 启动

当前实测路线使用**已有的 Ubuntu WSL**，运行项目专用 Docker Engine；两个容器共享 WSL host network/IP，以端口和路径区分服务。不创建新 VM，不使用 Windows 代公告器。

需要 Windows、Node.js 24+、已有 x86-64 Ubuntu WSL。启动脚本缓存官方 Docker static 工具，缺少 Compose 时下载并校验固定版本插件；运行命令不依赖 Docker Desktop 的 WSL CLI 链接。初次 Node 基础镜像需要预缓存或从已有本地 Docker 引擎导出。插件对应 Harness Desktop 0.2.1-rc.3 和 0.2.1-rc.5。

```powershell
npm ci --ignore-scripts
npm test
.\scripts\doctor.ps1
.\scripts\start-demo.ps1
node scripts/verify-live.mjs
```

按 [Windows 快速部署](docs/windows-quickstart.md) 和 [插件安装说明](docs/plugin-setup.md) 操作。Demo 的 `vendor/` 包含版本化组件安装包，单独取得本仓库即可 `npm ci`，无需旁边再放其他源码仓库。使用已安装 Harness 自带 CLI 安装 `vendor/dsh-lan-discovery-0.5.0.tgz`。Windows 防火墙弹窗需要用户手动处理。

在 Harness 侧栏打开“局域网服务 / LAN services”。初始列表像 Wi-Fi 选择器一样，仅展示服务名称、地址、已知能力和 key 状态；点击一项后再出现检查、连接和 key 输入等操作。每次只展开一项，选中本身不会自动连接；收起或切换服务会清除未提交的密码。插件支持中文和英语，使用 Harness 官方语言服务，优先跟随 Harness 语言偏好，没有偏好时跟随系统语言。能力标签来自已认证的服务声明；信任配置独立初始化，不靠发现记录授权未知服务。

**三种认证状态：** DeepSeek 无需 key；GLM 使用已经保存的 key；Qwen-VL 尚未填写 key。首次准备时，展开 GLM，从 `.runtime/current/presenter/demo-api-keys.txt` 取得其随机演示 key，保留“记住 API key”后验证连接，Qwen-VL 保持未配置。“已保存”仅说明本地有凭据，不表示刚刚连接成功。保存的 key 可跨 Harness 重启恢复，也可取消勾选而仅本次使用。插件采用 Harness 官方凭据服务；当前默认 provider 写入本地未加密 YAML，页面和公告不返回 key。旧环境迁移、错误 key 重试及重置步骤见 [API key 演示说明](docs/api-key-demo.md)。

免 key 的 Open Responses 服务是本 Demo 的明确实验扩展：当前草案 -00 的绑定要求 `auth=required`。两种方式都保留独立 TLS 信任校验。

停止：

```powershell
.\scripts\stop-demo.ps1
```

只停止本项目，保留凭据、镜像和专用 daemon 供重启。

## 文档与验证

- [完整实施计划 v0.4](IMPLEMENTATION_PLAN.md)
- [独立仓库与组件维护](docs/repositories.md)
- [当前验证报告及待完成项](docs/validation-report.md)
- [协议与能力扩展的边界](docs/protocol-mapping.md)
- [IETF 演示步骤](docs/demo-script.md)
- [容器到 Windows 的网络验证](docs/network-spike.md)
- [发布准备清单](docs/release-readiness.md)

发现核心库、服务端公告器、Harness 插件分别维护为独立源码仓库；本 Demo 只保留 `packages/mock-api` 和 `packages/lab-controller`，通过版本化安装包使用其他组件。四个项目采用 [MIT 许可证](LICENSE)，[四个 GitHub 源码仓库](docs/repositories.md) 可分别克隆；尚未发布 npm 或镜像 registry。

自动测试、真实网络调用、独立 observer、真实 Harness 桌面会话分别验收。不以模拟测试冒充完整桌面验收，不宣称完整 RFC 一致性。国际化与拆分后的实际验收状态以验证报告为准。
