# Documentation

## Quick start

Run commands from the repository root with Node.js 22 or newer:

```sh
npm ci
npm run dev
```

Use `npm run typecheck` to check types, `npm test` to run tests, and
`npm run build` to generate the production site in `_site/`. Development preview
output is kept separately in `_preview/`.

## Guides

- [Pages](pages.md): page locations, URLs, editorial conventions, and redirects.
- [Image posts](image-posts.md): image assets and Markdown front matter.
- [Charts](charts.md): authoring, rendering, responsive layouts, and build/runtime architecture.
- [Preview server](preview-server.md): file browser, Markdown editor, preview-only pages, and troubleshooting.
- [Testing](testing.md): checks, test discovery, fixtures, visual validation, and pre-commit hooks.
- [Kernel CVE data](kernel-cve-data.md): updating counts and reproducing a dataset snapshot.

## Repository map

- `src/pages/`: published pages and page-local data, renderers, and tests.
- `src/charts/`: shared chart definitions, sizing, and browser runtime.
- `src/_includes/`: page layouts and shared templates.
- `src/assets/`: shared site assets.
- `preview/`: preview-only tools and their tests.
- `scripts/`: build and test tooling.
- `tests/`: shared tests and helpers.
- `eleventy.config.js`: site generation and preview configuration.

Paths in these guides refer to the repository root unless stated otherwise.
