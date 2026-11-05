# Project website

Static site for Local LLM API Discovery. No build step and no external services: plain HTML, CSS and JavaScript, with fonts and images served from `assets/`.

| File | Content |
|---|---|
| `index.html` | Home page: problem, scenarios, benefits, how it works, components |
| `technical.html` | Technical details: records, TXT keys, discovery flow, trust, network changes |
| `assets/site.css`, `assets/site.js` | Shared styles, language switch, and the animated diagrams (hero list, network move, discovery paths). Animations stop when the reader prefers reduced motion. |
| `assets/img/` | Screenshots of the Harness plugin (`*.en.jpg`, `*.zh.jpg`) |
| `assets/fonts/` | Bricolage Grotesque and JetBrains Mono (SIL Open Font License, see the `OFL-*.txt` files) |

## Languages

English is the default. Every piece of text is written twice, side by side:

```html
<span data-l="en">Scenarios</span><span data-l="zh" lang="zh-CN">场景</span>
```

The **EN / 中文** switch shows one language and remembers the choice in the browser. A link can force a language with `?lang=zh` or `?lang=en`. When you edit text, change both versions.

## Preview locally

```sh
cd website
python3 -m http.server 8000
```

Then open http://localhost:8000/. Opening the HTML file directly also works, but browsers block the bundled fonts on `file://` pages.

## Publish on GitHub Pages

1. In the repository on GitHub, open **Settings → Pages** and set **Source** to **GitHub Actions**.
2. Commit and push the website and workflow, then run **Deploy discovery website** manually from the **Actions** tab.

The workflow in `.github/workflows/website-pages.yml` uploads this folder as it is. The site will be at `https://nobrowning.github.io/llm-service-discovery-demo/`.
