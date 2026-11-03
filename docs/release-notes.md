Demo 0.6.1 adds one native deployment for macOS, Linux and Windows while retaining the Windows/Ubuntu WSL container deployment.

- `llm-service-discovery-demo-0.6.1-native.zip`: installed JavaScript dependencies, plugin and common CLI, no Docker image. Requires Node.js 24+ for your architecture. Run `node scripts/verify-release-files.mjs`, list interfaces, then `node packages/lab-controller/cli.mjs native run --runtime .runtime/native --interface YOUR_LAN_IPV4`. See `docs/native-quickstart.md`.
- `llm-service-discovery-demo-0.6.1-windows-x64-wsl.zip`: the same sources/dependencies plus a prebuilt linux/amd64 image. Requires Windows x64, Node.js 24+, existing x64 Ubuntu WSL. Run `scripts/start-demo.ps1`; first-time Docker static/Compose downloads require internet. See `docs/windows-quickstart.md`.
- `SHA256SUMS`: verify the archive before extraction. Each ZIP also has a manifest and per-file checksums. Automatic Source code archives do not include installed dependencies or the image.

Native startup manages two API/advertiser children, waits for readiness, and withdraws announcements on stop. Status, stop and lifecycle tests use an authenticated loopback channel. Multiple interfaces require an explicit local IPv4; incomplete runtime directories are preserved and rejected. Private files are generated locally and retained across restarts.

Bundled components: core 0.3.1, advertiser 0.3.1 and Harness plugin 0.5.1. The advertiser exposes interface listing, example configuration and configuration-only validation. Plugin release verification handles Windows tar paths and Unix temporary-directory aliases. CI checks Windows x64, Linux x64/arm64 and macOS x64/arm64 with architecture assertions.

Use the CLI bundled with your Harness Host. Compatibility remains 0.2.1-rc.3/rc.5. Desktop UI verification, Linux Web Host evaluation and server/network verification are separate; see `docs/validation-report.md`. The native ZIP is not a standalone app installer, and the WSL image is not multi-architecture. Runtime credentials and profiles are excluded.
