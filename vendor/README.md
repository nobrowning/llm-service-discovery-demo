# Component snapshots

The current MIT-licensed snapshots are discovery core `0.3.1`, advertiser `0.3.1` and Harness plugin `0.5.2`, built from the independent `llm-discovery-core`, `llm-api-advertiser` and `dsh-lan-discovery` repositories. `manifest.json` and the package lock identify the installed versions. These are source packages, not model weights. They intentionally belong in Git so this demo can be cloned and installed without sibling checkouts or unpublished registry packages.

`manifest.json` records each artifact's package, source repository name, version and SHA-256. `npm ci --ignore-scripts` also verifies lockfile integrity; `node scripts/verify-components.mjs` checks the manifest and installed versions. All source and third-party license texts accompany the relevant archives.

Generate an archive from its source repository with `npm pack --pack-destination <demo>/vendor`. For the plugin, run `npm run build` first. Version and update consumers in dependency order; see [repository maintenance](../docs/repositories.md). The included archives have not been published to npm.
