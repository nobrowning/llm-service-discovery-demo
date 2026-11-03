# Harness 插件安装

插件源码位于 [dsh-lan-discovery](https://github.com/nobrowning/dsh-lan-discovery)。Demo 随附经过版本锁定的 `vendor/dsh-lan-discovery-0.4.0.tgz`，可直接安装，不需要另克隆插件仓库，也不依赖本机开发目录。当前明确支持 Harness Desktop **0.2.1-rc.3 和 0.2.1-rc.5**；两个版本分别完成的桌面检查见[验证报告](validation-report.md)。

## 安装与配置

先在 Demo 根目录执行 `npm ci --ignore-scripts` 和 `scripts/start-demo.ps1`。完全退出 Harness，然后用该 Desktop 安装自带的 CLI 添加包。替换下面的安装路径，避免用另外安装的 CLI 修改 Desktop profile：

```powershell
$dsh = 'C:\Path\To\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd'
& $dsh plugin --profile desktop add (Join-Path (Get-Location) 'vendor/dsh-lan-discovery-0.4.0.tgz')
```

配置 profile 中已有的 `lan-discovery` 行，保留其他字段与插件。使用启动脚本打印的信任文件路径、`doctor` 给出的 Windows 接口地址：

```yaml
- id: lan-discovery
  config:
    trustFile: 'C:\Path\To\Demo\.runtime\current\client\trust.json'
    interfaceAddress: 'WINDOWS_VIRTUAL_LAN_IP'
    networkId: 'ietf-demo'
    autoStart: true
    demoMode: true
```

`demoMode: true` 仅用于本 Demo：开启固定的只读 marker 工具和 Mock 请求上下文标记。插件独立安装时默认关闭，读取通用实验能力接口 `/_llm/capabilities`。能力接口与发现协议的关系见独立插件仓库的 `docs/service-contract.md`。

如果旧版本是开发目录链接，pnpm 可能继续保留旧链接。先断开连接并退出 Harness，备份这条插件配置，再通过同一官方 CLI 执行 `plugin --profile desktop remove dsh-lan-discovery`，随后重新 `add` 上述 tgz，并检查原信任配置仍在。`remove` 不接受 `--ignore-scripts` 参数；不要手动删除整个 profile 或 node_modules。本机已用该流程完成从旧开发链接到独立安装包的迁移。

重新启动 Harness，侧栏显示 **局域网服务 / LAN services**。检查服务后可连接并新建正常会话；断开按钮会在适用时恢复原默认模型。禁用、升级或卸载前先断开。不要把 `client/trust.json`、token、证书私钥或 marker 上传到仓库。

## API key 保存

0.4.0 的密码输入默认勾选“记住 API key”。验证成功后通过 Harness 官方 `credentials` 服务保存，重启后显示已保存状态；key 本身不回填页面。当前默认 provider 在本机 profile 保存未加密 YAML，不是系统加密保险库。取消勾选可仅本次使用；清除会删除该插件拥有的对应凭据并撤销其连接，不影响其他 provider。

Demo 准备为 DeepSeek 免 key、GLM 已保存、Qwen-VL 待输入。先在 GLM 卡片验证并保存其合成 key，Vision 保持未配置，步骤见 [API key 演示](api-key-demo.md)。发现不会自动导入服务端 key。

## 语言

插件直接接入 Harness 官方 locale 服务。Harness 内明确选择的语言优先；未设置时由 Harness 根据操作系统或浏览器语言选择，未匹配的语言回退为英语。支持英语、中文，切换后页面及侧栏立即更新，不需要重启插件。模型名称、IP、`.local` 主机名和协议字段保持原值。

## 开发

在独立插件仓库执行 `npm ci --ignore-scripts`、`npm run build`、`npm test`、`npm pack`。可将完整插件源码路径交给同一个 `dsh plugin add` 命令作开发链接；此时该源码目录和依赖必须保留。普通使用者优先安装 tgz 包。

四个源码仓库已经公开在 GitHub；尚未发布 npm 包。Demo 的 `vendor/` 固定了可安装组件快照，具体来源和更新顺序见 [仓库说明](repositories.md)。
