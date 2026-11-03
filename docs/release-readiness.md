# 发布准备

项目采用 MIT 许可证，拆分为发现核心库、服务端公告器、Harness 插件和 Demo 四个独立源码仓库。源码仓库链接见 [仓库与依赖](repositories.md)；尚未发布 npm 或镜像 registry。

Demo 通过 `vendor/*.tgz` 使用发现核心库 / 公告器 0.3.1 和 Harness 插件 0.5.1 安装包，并用 lockfile 固定依赖；只取得 Demo 仓库即可执行 `npm ci`，无需其他仓库位于相邻目录。插件安装与配置见 [plugin-setup.md](plugin-setup.md)，组件维护和更新方式见 [repositories.md](repositories.md)。

## 已准备

- GitHub Release 分发流程：组件提供 tgz 与 SHA256SUMS；Demo 提供三平台 native ZIP，以及另带 linux/amd64 镜像的 Windows/WSL ZIP。tag workflow 先生成草稿，下载验收后发布。
- Demo 0.6.1 启动器校验发行镜像 SHA-256、tag 与 image ID，再载入专用 daemon；部署 ZIP 不需本地构建和 Node 基础镜像，首次工具下载仍需网络。
- 中英文 README、原生 macOS/Linux/Windows 指令、Mac SSH 连接说明、插件平台限制、演示脚本与 Windows 快速启动。
- 免 key / 已保存 key / 待输入 key 的三服务演示；密码输入、错误重试、Harness 凭据持久化与可选仅本次使用，独立 TLS 信任。当前默认凭据 provider 是本地未加密 YAML，文档说明此限制。
- 先浏览、再展开单项的服务选择流程；密码框及管理操作按需显示，收起或切换会清除未提交密码。主列表仅显示通用服务与凭据状态，模拟性质放在明确声明的服务详情中，普通服务无需“非 Mock”标签。
- 已选定 MIT；各仓库保留许可证和版权声明。
- 可复用源码的独立仓库边界，以及 Demo 使用版本化组件包的部署方式。
- 插件使用 Harness 官方 locale 服务支持中文与英语，优先跟随 Harness 偏好，否则跟随系统语言。
- npm lockfile、两容器 Compose、隔离 daemon 脚本、只包含服务代码的离线构建。
- 协议/API/插件边界自动测试，以及真实网络/独立 observer 验证脚本。
- 忽略 .runtime、node_modules、.reference、密钥、token 和机器上的证据文件；`vendor/` 中经过审查的组件 tarball 是有意纳入版本控制的部署依赖。
- 插件使用 npm files 白名单；本地参考解包、用户 profile 不在发行文件内。
- 历史四服务版本的本机真实 Harness 桌面验收覆盖四服务发现、能力筛选、Text/Basic 文本、图片字节传输、原生工具往返、冷启动恢复和断开恢复默认模型。0.4.0 的三服务及持久化验收、0.5.0 的列表交互验收按实际执行分别记录，不能直接沿用旧验收结论；详见验证报告。

## 发布前完成

1. 逐平台扩展验证：Mac arm64 第二台机器的原生服务和 Windows↔Mac 双向网络已实测；Mac Harness UI、Linux Web Host、独立物理 Linux/Avahi 仍须单独验收。已有 x64 WSL 仅为 Windows 容器路线的前提，native 路线不需要 WSL。
2. 对每个待发布版本执行独立安装、测试、`npm pack` 内容审查和 Demo 集成验证；记录实际 Harness 的中英文切换及打包插件接入结果。不可用开发 checkout 测试代替 tarball 安装测试。
3. 后续版本发布前确认远程分支、标签与发行包对应。四个公开源码仓库统一位于 `nobrowning` 账号，链接见仓库说明。
4. 若转向 npm registry 分发，先确认 package scope/名称可用，再按核心库、公告器/插件、Demo 的依赖顺序发布并更新 lockfile；本地 tarball 不表示已经发布 npm。
5. Release manifest 固定镜像 ID、归档 SHA-256 与支持版本；后续补做实际断公网演示。首次工具下载尚需联网，当前不宣称完整离线安装。
6. 审查拟提交文件和 tarball，不包含个人路径、运行证书、token、用户对话、原应用解包或私有参考源码。共享验证证据前按用途脱敏。
7. 运行各仓库 CI 与发布校验；基础命令为 `npm ci --ignore-scripts` 和 `npm test`，组件包还需通过各自构建与打包检查。
8. 明确草案版本与实验能力扩展；避免完整 RFC 一致性或真实模型能力的宣称。

## 第三方依赖

| 依赖 | 当前版本 | 声明许可证 | 用途 |
|---|---|---|---|
| multicast-dns | 7.2.5 | MIT | mDNS socket 与报文 |
| dns-packet | 5.6.1 | MIT | DNS 编解码 |
| thunky | 1.1.0 | MIT | multicast-dns 依赖 |
| @leichtgewicht/ip-codec | 2.0.5 | MIT | 地址编码 |
| node-forge | 1.4.2 | BSD-3-Clause OR GPL-2.0 | 本地实验证书生成 |

版本以 package-lock.json 为准；再分发时保留所选许可证和原版权声明。Docker static binaries、Node/Alpine 镜像、DeepSeek Harness 与独立 Python zeroconf 工具各有自己的许可证；不能将项目许可证代替它们。
