# 通过 SSH 验证 Mac

Windows 与 Mac 在同一局域网时，可在 Mac「系统设置 → 通用 → 共享 → 远程登录」允许指定用户，使用设置给出的 `ssh 用户名@主机.local` 连接。只需普通用户权限，不需要打开远程用户的完全磁盘访问。

1. 在 Mac 本机运行 `ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub`，核对首次连接显示的主机指纹。
2. 将 Windows 用户选定的 **公钥**（例如 `~/.ssh/id_rsa.pub` 或独立 ed25519 公钥）加入 Mac 的 `~/.ssh/authorized_keys`，目录权限 700，文件权限 600。私钥留在 Windows；不在聊天中发送密码或私钥。
3. Windows 使用已核对的 known_hosts 记录测试：`ssh -o BatchMode=yes -o StrictHostKeyChecking=yes 用户名@主机.local "sw_vers; uname -m"`。已有受信记录时直接复用；主机密钥变化时先查原因。
4. 在 Mac 用户目录中新建独立测试目录，安装对应架构的 Node.js 24+，传入经过校验的 native ZIP，按 [原生启动](native-quickstart.md) 操作。可只解压官方 Node 归档到测试目录并临时设置 PATH，不必安装 Homebrew 或修改系统 Node。

SSH 可以完成安装包、帮助指令、单元测试、原生进程和网络验证；它不能单独证明 Harness 的图形界面交互、权限弹窗或 Keychain 行为。最后的桌面验收应在 Mac 本机打开 Harness，按 [演示步骤](demo-script.md) 检查三项服务以及文本、图像和工具会话。

跨设备测试时服务端使用 Mac 的 LAN 地址，Windows 使用自己的 LAN 接口。WSL 内部地址不自动成为 Mac 可达地址。仅传递实验客户端信任与明确需要的合成测试凭据；普通客户端不需要服务端私钥。
