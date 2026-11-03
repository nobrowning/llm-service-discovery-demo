Download **llm-service-discovery-demo-0.5.1-windows-x64-wsl.zip** from Assets. GitHub's automatic Source code archives do not include the prebuilt image or installed dependencies.

The deployment ZIP includes the two-node/three-service Mock API image, JavaScript runtime dependencies, Harness plugin 0.5.0, discovery core/advertiser 0.3.0, and file checksums. No model weights or GPU are required.

Requirements: Windows x64, Node.js 24+, an existing x86-64 Ubuntu WSL distribution, and DeepSeek Harness Desktop 0.2.1-rc.3 or rc.5 for the client UI. The first start downloads verified Docker static tools and Compose if absent. This is not a fully offline installer and does not install WSL or Harness.

Extract to a permanent local directory and run in PowerShell:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\start-demo.ps1
```

The launcher verifies and imports the bundled image, creates local certificates and synthetic demo API keys, and checks that all three services are discoverable. It does not build an image or require Docker Desktop. Then follow `docs/plugin-setup.md` to install the bundled plugin and configure the printed trust-file path and Windows interface address. First-time users save the GLM key once through the plugin; Qwen remains awaiting a key, while DeepSeek needs none.

Stop with `scripts/stop-demo.ps1`. Keep the extracted directory because runtime credentials and trust files live there. Only the Windows/Ubuntu WSL route is claimed here; Linux CI does not establish Linux desktop or physical-LAN acceptance. Clean-directory validation on the maintainer's Windows machine is distinct from validation on a second machine.

For later versions, update these notes before tagging. The tag workflow creates a draft with the ZIP and SHA256SUMS; download acceptance must pass before publishing the draft.
