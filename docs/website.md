# Website baseline / 网站基线

The active website is the user's updated upload, `llm-discovery-website (1).zip`, adopted on 2026-11-05. Treat this version as the only baseline for future website work. The previous assistant-designed site and its generators are retired.

当前网站以用户在 2026-11-05 上传的 `llm-discovery-website (1).zip` 为唯一基线。后续修改直接基于这份网站，不再使用此前助手制作的网站及生成脚本。

## Source and verification / 来源与核对

- Source SHA-256: `6501e7fbbeebb0eca0588eb8951215aa64e8df3f096e4dcb8fdbca53de508d95`.
- All 14 files under `website/` match the uploaded archive byte for byte at adoption. No page content, images, styling or interaction was changed during import.
- Two HTML pages, 48 local asset/anchor references, and JavaScript syntax passed checks. Browser visual review was not completed during this import.
- `index.html` and `technical.html` each contain both languages. English is the fresh-browser default; language selection is saved locally. `?lang=en` and `?lang=zh` override the saved preference.
- Plain HTML/CSS/JavaScript with bundled fonts; there is no build step. Edit both `data-l="en"` and `data-l="zh"` copy together.

导入时逐文件核对了 14 个文件，内容与原压缩包完全一致，未修改页面设计、交互或素材。站内 48 个引用及 JavaScript 语法检查通过；本次导入未完成浏览器视觉复核。

## Preview / 预览

From the repository root:

```sh
python3 -m http.server 8877 --bind 127.0.0.1 --directory website
```

Visit `http://127.0.0.1:8877/`. Fonts work best through a local server rather than a file URL.

## GitHub Pages integration / 发布路径

The repository's actual site directory is `website/`. Its existing workflow is `.github/workflows/website-pages.yml`, named **Deploy discovery website**, triggered manually with `workflow_dispatch`. It uploads `website/` directly and does not run a site generator. The publication target is https://nobrowning.github.io/llm-service-discovery-demo/.

The site and its README now use the four checked-out repositories’ `nobrowning` GitHub URLs. The README matches this checkout’s `website/` directory and manual Pages workflow.

网站及 README 的 GitHub 地址已与四个本地仓库的 `nobrowning` remote 统一；README 已同步当前目录及手动发布工作流。发布地址为 https://nobrowning.github.io/llm-service-discovery-demo/ 。

## Previous material / 旧材料

The previous website, website documentation, build generators and deployment ZIP were moved out of the active repository into a local archive at `/Users/dcg/code/LLM_Discovery/website-archive/assistant-version-before-6501e7fbbeeb/`. They are historical reference only. In particular, do not restore or run the previous `build-website.py` against this selected design.

The separate high-resolution screenshot archive remains available at `/Users/dcg/code/LLM_Discovery/dsh-discovery-screenshots-hq.zip`. Reusing those images, if desired, should preserve the newly selected site's composition and styling.

## Link update — 2026-11-05

On the selected design, the homepage hero now links directly to the demo on GitHub and the IETF draft. The draft/status section links to the four-project footer. Both pages share that footer, with each repository’s full name and a short bilingual purpose label. Existing repository links were corrected to the current remotes. Layout, imagery and animations otherwise retain the uploaded baseline.

## Publishing updates / 后续更新

Push changes to `website/` on `main`, then run **Deploy discovery website** from GitHub Actions. Deployment remains manual. Only `website/` is included in the Pages artifact.

将网站改动推送到 `main` 后，在 Actions 中手动运行 **Deploy discovery website**。发布内容仅包含 `website/` 目录。
