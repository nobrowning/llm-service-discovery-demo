# Harness 插件安装

插件源码位于 [dsh-lan-discovery](https://github.com/nobrowning/dsh-lan-discovery)。Demo 随附经过版本锁定的 `vendor/dsh-lan-discovery-0.5.2.tgz`，可直接安装，不需要另克隆插件仓库。Host 兼容版本为 **0.2.1-rc.3 和 0.2.1-rc.5**；平台、Host 与实际界面验收范围见[验证报告](validation-report.md)。

## 安装与配置

macOS 用户可按[完整 Desktop 指南](mac-desktop-quickstart.md)完成应用初始化、插件配置、本地网络权限与真实会话检查。

先按[原生部署](native-quickstart.md)启动；Windows/WSL 路线使用 `scripts/start-demo.ps1`。Release ZIP 已带 JavaScript 依赖，从源码克隆时先执行 `npm ci --ignore-scripts`。首次安装 Harness 时，先启动 Desktop 一次以初始化 profile，再完全退出；使用该 Desktop 安装自带的 CLI 添加包。替换下面的安装路径：

```powershell
$dsh = 'C:\Path\To\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd'
& $dsh plugin --profile desktop add (Join-Path (Get-Location) 'vendor/dsh-lan-discovery-0.5.2.tgz') --ignore-scripts
```

macOS 使用已安装 `.app` 内的 CLI；以实际应用名为准：

```sh
DSH='/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh'
"$DSH" plugin --profile desktop add "$PWD/vendor/dsh-lan-discovery-0.5.2.tgz" --ignore-scripts
```

不要假定 npm 全局 CLI 与桌面 Host 版本一致。Linux 可单独运行发现服务与验证器；官方 Desktop 未提供 Linux 发布目标，Web Host 的 UI/生命周期/凭据能力需单独验收，详见插件仓库的 [平台说明](https://github.com/nobrowning/dsh-lan-discovery/blob/main/docs/platform-support.md)。

配置 profile 中已有的 `lan-discovery` 行，保留其他字段与插件。使用启动时打印的信任文件路径，以及客户端自己所选接口的 IPv4：

```yaml
- id: lan-discovery
  config:
    trustFile: 'C:\Path\To\Demo\.runtime\current\client\trust.json'
    interfaceAddress: 'CLIENT_LOCAL_IPV4'
    networkId: 'ietf-demo'
    autoStart: true
    demoMode: true
```

原生路线默认示例 runtime 为 `.runtime/native`；Unix 上改为真实绝对路径，例如 `/Users/alice/demo/.runtime/native/client/trust.json`。配置不会展开 `~`、`$HOME` 或 `%USERPROFILE%`。跨设备使用服务端通过可信通道提供的 `client/` 信任目录，接口则选择客户端自己的 LAN 地址。默认状态文件写在 trustFile 同目录；若信任文件放在只读目录，显式配置可写的绝对 `stateFile`，不要放宽服务端私钥权限。

`demoMode: true` 仅用于本 Demo：开启固定的只读 marker 工具和 Mock 请求上下文标记。插件独立安装时默认关闭，读取通用实验能力接口 `/_llm/capabilities`。能力接口与发现协议的关系见独立插件仓库的 `docs/service-contract.md`。

如果旧版本是开发目录链接，pnpm 可能继续保留旧链接。先断开连接并退出 Harness，备份这条插件配置，再通过同一官方 CLI 执行 `plugin --profile desktop remove dsh-lan-discovery`，随后重新 `add` 上述 tgz，并检查原信任配置仍在。`remove` 不接受 `--ignore-scripts` 参数；不要手动删除整个 profile 或 node_modules。本机已用该流程完成从旧开发链接到独立安装包的迁移。

重新启动 Harness，侧栏显示 **局域网服务 / LAN services**。初始为紧凑服务列表；点击一项，展开后检查或连接并新建正常会话。一次只展开一个服务，选中不会自动连接，收起或切换会清除未提交的密码。断开按钮会在适用时恢复原默认模型。禁用、升级或卸载前先断开。不要把 `client/trust.json`、token、证书私钥或 marker 上传到仓库。

列表的普通服务没有统一的 Mock / 非 Mock 标签。已注册插件路由的服务显示“已接入”；接口明确声明 `mock: true` 时，模拟服务说明放在展开详情里。发现本身不表示服务已受信或可用。

## API key 保存

展开服务后的密码输入默认勾选“记住 API key”。验证成功后通过 Harness 官方 `credentials` 服务保存，重启后显示已保存状态；key 本身不回填页面。当前默认 provider 在本机 profile 保存未加密 YAML，不是系统加密保险库。取消勾选可仅本次使用；清除会删除该插件拥有的对应凭据并撤销其连接，不影响其他 provider。

Demo 准备为 DeepSeek 免 key、GLM 已保存、Qwen-VL 待输入。先展开 GLM，验证并保存其合成 key，Vision 保持未配置，步骤见 [API key 演示](api-key-demo.md)。发现不会自动导入服务端 key；“已保存”仅指本地有凭据，每次接入仍会验证服务。

## 语言

插件直接接入 Harness 官方 locale 服务。Harness 内明确选择的语言优先；未设置时由 Harness 根据操作系统或浏览器语言选择，未匹配的语言回退为英语。支持英语、中文，切换后页面及侧栏立即更新，不需要重启插件。模型名称、IP、`.local` 主机名和协议字段保持原值。

## 开发

在独立插件仓库执行 `npm ci --ignore-scripts`、`npm run build`、`npm test`、`npm pack`。可将完整插件源码路径交给同一个 `dsh plugin add` 命令作开发链接；此时该源码目录和依赖必须保留。普通使用者优先安装 tgz 包。

四个源码仓库已经公开在 GitHub；尚未发布 npm 包。Demo 的 `vendor/` 固定了可安装组件快照，具体来源和更新顺序见 [仓库说明](repositories.md)。
