# LAN LLM API discovery demo

[中文说明](README.zh-CN.md) · [Implementation plan](IMPLEMENTATION_PLAN.md) · [Validation report](docs/validation-report.md)

Discover local LLM APIs inside **DeepSeek Harness Desktop**, then connect from a normal conversation. An implementation experiment for [draft-cui-dawn-local-llm-api-discovery-00](https://datatracker.ietf.org/doc/draft-cui-dawn-local-llm-api-discovery/).

Three Docker containers publish their **own** mDNS/DNS-SD announcements. Node A serves independent text and vision APIs; B serves function calling; C serves basic text. All are clearly labelled mocks, with real HTTPS, bearer authentication, SSE, image-byte transfer and correlated tool results. No model weights, GPU or cloud key.

Cards use recognizable DeepSeek, Qwen and GLM model names with simulated deployment sizes, versions and precision settings. Only distinctive image/tool capabilities appear as badges. See [model presentation and source references](docs/model-presentation.md); these labels do not imply that the actual model weights are running.

The verified Windows topology runs a dedicated Docker daemon in an **existing Ubuntu WSL** distribution. Containers share its host network/IP, distinguished by port and base path. Windows runs only the native discovery client. Docker Desktop host-mode multicast did not work on the tested machine; no Windows advertiser or static discovery list is substituted.

## Quick start

Prerequisites: Windows, Node.js 24+, and an existing x86-64 Ubuntu WSL distribution. The startup script caches the official Docker static tools and, when needed, a checksum-pinned Compose plugin; runtime commands do not depend on Docker Desktop's WSL CLI symlinks. The initial Node base image must be cached or exported from an existing local Docker engine. Desktop plugin compatibility: **0.2.1-rc.3 and 0.2.1-rc.5**.

```powershell
npm ci --ignore-scripts
npm test
.\scripts\doctor.ps1
.\scripts\start-demo.ps1
node scripts/verify-live.mjs
```

Follow [Windows setup](docs/windows-quickstart.md), then [install the Harness plugin](docs/plugin-setup.md). This demo includes versioned component tarballs under `vendor/`, so `npm ci` works from this repository alone; sibling source checkouts are not required. Install `vendor/dsh-lan-discovery-0.3.1.tgz` with the CLI bundled with the installed Harness Desktop. These local artifacts have not been published to npm.

Open **LAN services / 局域网服务**, inspect a service's capabilities, then connect and start a new conversation. The plugin supports English and Chinese through Harness's official locale service: the Harness preference takes priority, with system language as the fallback. Experiment trust is provisioned independently. Discovery alone never authorizes sending credentials.

**Mixed authentication:** DeepSeek and Qwen3 connect without a key. Qwen-VL and GLM require the matching synthetic key from `.runtime/current/presenter/demo-api-keys.txt`; enter it in the service card and choose **Verify and connect**. A wrong key can be retried. Keys entered into the plugin stay in Host memory for this Harness run only. See the [API key demonstration](docs/api-key-demo.md) for migration, reset and test steps. No real provider credentials are needed.

The keyless Open Responses services are an explicit experimental extension: the current draft -00 binding requires `auth=required`. Authentication hints never replace local TLS trust.

```powershell
.\scripts\stop-demo.ps1
```

Stopping affects only this Compose project; credentials, images and the dedicated daemon are retained for restart.

## What to inspect

- [Repository boundaries and component maintenance](docs/repositories.md)
- [Protocol mapping and experiment boundaries](docs/protocol-mapping.md)
- [Five-minute IETF demonstration](docs/demo-script.md)
- [Network investigation](docs/network-spike.md)
- [Mock API contract](packages/mock-api/README.md)
- [Capability schema](schemas/capabilities.v1.schema.json)

Unit tests, live network verification, independent DNS-SD observation and actual Desktop interaction are separate acceptance levels. See the validation report for what has actually run. Full RFC conformance, cross-subnet discovery, real inference and a second-machine reproduction are outside the verified scope.

## Sharing this repository

The reusable discovery core, server advertiser and Harness plugin each have their own source repository. This demo keeps only its Mock API and lab controller under `packages/` and consumes packaged components. See [repository boundaries](docs/repositories.md) for the dependency flow and update process.

The project uses the [MIT License](LICENSE). Runtime secrets, local reference extracts, installed dependencies and machine-specific evidence are excluded by .gitignore; versioned `vendor/*.tgz` component artifacts are intentionally included. Do not publish `.runtime` or client trust files. The four source repositories are linked in [repository boundaries](docs/repositories.md). npm and image-registry releases are not published; review [release readiness](docs/release-readiness.md) before those distributions.
