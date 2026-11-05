# Download, run and develop the demo

> Complete reference for installation, configuration and development. For a short overview, see the [README](../README.md).

[中文说明](running.zh-CN.md) · [Validation report](validation-report.md) · [Protocol mapping](protocol-mapping.md)

Discover LAN LLM APIs inside DeepSeek Harness, inspect a service, and connect from a normal conversation. An implementation experiment for [draft-cui-dawn-local-llm-api-discovery-00](https://datatracker.ietf.org/doc/draft-cui-dawn-local-llm-api-discovery/).

Two nodes publish their own mDNS/DNS-SD announcements for three Mock services: DeepSeek text, Qwen vision, and GLM function calling. HTTPS, authentication, SSE, image-byte transfer and tool-result correlation are real; inference is simulated. No model weights, GPU or cloud key is needed. [Model labels](model-presentation.md) do not imply actual model weights are running.

## Download and run

Choose an asset from [GitHub Releases](https://github.com/nobrowning/llm-service-discovery-demo/releases/tag/v0.7.0-roaming.1) and compare its SHA-256 with the same release's `SHA256SUMS`.

| Deployment | Asset | Prerequisites |
|---|---|---|
| Native processes on macOS, Linux or Windows | `llm-service-discovery-demo-0.7.0-roaming.1-native.zip` | Node.js 24+ for your OS/architecture |
| Two Linux containers, Windows client | `llm-service-discovery-demo-0.7.0-roaming.1-windows-x64-wsl.zip` | Windows x64, Node.js 24+, existing x64 Ubuntu WSL |

Both contain JavaScript dependencies and the plugin tgz. Only the WSL ZIP contains the prebuilt linux/amd64 image. Node.js and Harness are installed separately. GitHub's automatic **Source code** archives require `npm ci --ignore-scripts` first.

For the native ZIP, run these commands from the extracted directory:

```sh
node scripts/verify-release-files.mjs
node packages/lab-controller/cli.mjs list-interfaces
node packages/lab-controller/cli.mjs native run --runtime .runtime/native --interface YOUR_LAN_IPV4
```

Replace `YOUR_LAN_IPV4` with a local address from the list. Keep the foreground terminal open. In another terminal, enter the same extracted directory:

```sh
node scripts/verify-live.mjs --runtime .runtime/native
node scripts/verify-lifecycle.mjs --backend native --runtime .runtime/native
```

Keep the service terminal running while using Harness. When finished, stop with `node packages/lab-controller/cli.mjs native stop --runtime .runtime/native` or Ctrl+C in that terminal.

See [native setup](native-quickstart.md) for interface selection, cross-device trust, permissions and optional Linux Docker Engine instructions. Mac users can follow the [Desktop guide](mac-desktop-quickstart.md) for plugin installation and conversation checks, or [SSH setup](mac-ssh-validation.md) for remote testing. Runtime certificates and synthetic keys are generated locally and retained across restarts.

For the WSL ZIP, use Windows PowerShell:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\start-demo.ps1
```

The launcher verifies/imports the bundled image into the project daemon. First-time Docker static/Compose downloads require internet. See [Windows setup](windows-quickstart.md); stop with `scripts/stop-demo.ps1`. Containers share the WSL host IP with different ports/base paths. This does not establish Docker Desktop multicast support.

## Harness client

Install `vendor/dsh-lan-discovery-0.6.0-roaming.1.tgz` using the CLI belonging to your Harness installation, then set the trust file and `interfaceMode: auto` to follow the client's current LAN. See [plugin setup](plugin-setup.md). Host compatibility is pinned to **0.2.1-rc.3 / rc.5**. Windows/macOS Desktop, Linux Web Host evaluation, and standalone service execution have separate acceptance requirements.

Open **LAN services / 局域网服务**. Select a row to reveal inspection, connection and API key controls. Selection does not connect automatically; collapse/switch clears unsent passwords. English/Chinese follows Harness's locale preference. Discovery alone never authorizes sending credentials.

**Three key states:** DeepSeek needs none; save the synthetic GLM key once; leave Qwen-VL awaiting a key. The local presenter file is in your runtime's `presenter/demo-api-keys.txt`. [API key setup](api-key-demo.md) explains migration/reset. Saved keys use the Harness credential provider; its current default is an unencrypted local YAML file, not an OS keychain. No real provider credentials are needed.

The keyless Open Responses service is an explicit experimental extension: draft -00 requires `auth=required`. TLS trust is provisioned independently.

## Develop and validate

```sh
npm ci --ignore-scripts
npm test
node scripts/verify-components.mjs
node packages/lab-controller/cli.mjs --help
```

CI checks Windows x64, Linux x64/arm64 and macOS x64/arm64 with Node 24. Pure JavaScript dependencies do not need per-OS native addons. Unit/package checks, real mDNS/HTTPS tests, independent observers and actual Harness UI tests are separate evidence. Full RFC conformance, IPv6 multicast and cross-subnet discovery are not claimed.

- [Repository boundaries](repositories.md)
- [Release notes](release-notes.md) and [readiness](release-readiness.md)
- [Five-minute demonstration](demo-script.md)
- [Historical Windows network investigation](network-spike.md)
- [Mock API contract](../packages/mock-api/README.md)

Core, advertiser and plugin have their own repositories. Versioned tgz files in `vendor/` let this repository install independently. All four projects use [MIT](../LICENSE); npm and image-registry distributions are not published. Keep runtime directories, certificates, keys and user profiles out of shared archives.

## Company-to-home candidate

This prerelease bundles automatic network rediscovery. New runtimes accept `--scene company` or `--scene home`; see [model presentation](model-presentation.md). The company scene presents DeepSeek-R1-Distill-Qwen-32B (Q4_K_M), Qwen2.5-VL-7B-Instruct (BF16), and GLM-4-9B-Chat (INT4); home presents Qwen3-8B (Q8_0). These are simulated deployment labels, not running model weights. Existing runtime keys and certificates are retained; choose a new runtime directory for a different scene. [Validation scope](validation-report.md) distinguishes controlled Web Host evidence from physical-interface core/TLS checks.

[Company-to-home verification](company-home-validation.md) records the controlled UI and physical interface checks separately.
