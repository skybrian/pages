# Pages

One-off pages and charts for https://pages.skybrian.com.

## Development checks

Run `npm run typecheck` to check TypeScript and JavaScript types without
emitting files. To run the build, use `npm run build`.

When running the preview server with `npm run dev`, open
`/admin/files/` to browse the current worktree. This browser is registered only
in Eleventy's serve mode; production builds do not emit admin pages. It is
read-only and blocks symlinks rather than following them. Detected UTF-8 text
files are displayed as escaped text in a separate HTML page; binary, invalid
UTF-8, and non-regular files are not linked. Text previews are limited to
1 MiB, and files exceeding that limit are not previewed. No files are
downloaded or served as raw content. Supported source extensions are syntax
highlighted with MicroLighter; unrecognized extensions remain plain text.

Preview-only server-rendered pages can be authored as `.tsx` files under
`preview/`. The preview config loads their TypeScript entry points with the
scoped `tsx` loader, and `preview/render.tsx` provides `renderDocument()` for
rendering Preact children as complete HTML documents. Run `npm test` to execute
the TypeScript and TSX preview tests.

Enable the pre-commit typecheck hook for this worktree with:

```sh
git config --local core.hooksPath .githooks
```

The hook checks the working tree, not just the staged snapshot. You can bypass
it for a commit with `git commit --no-verify`.

## Page URLs and archives

Put pages under their year in `src/pages/`, for example:

- `src/pages/2026/anthropic-run-rates.html` → `/2026/anthropic-run-rates/`
- `src/pages/2026/my-image-post/index.md` → `/2026/my-image-post/`

The URL follows the source directory, not the post date. Start a new year by
creating `src/pages/2027/`; no configuration change is needed. The homepage
lists pages from all years. Year archive indexes are not generated automatically.

Permanent redirects for the original, yearless URLs are maintained in
`src/_redirects`, which is copied into the build output for Netlify. These
also preserve direct image links. Netlify handles these redirects in production;
the local Eleventy preview does not apply them.

## Image posts

Give each post a directory in `src/pages/2026/`, with its image next to `index.md`:

```text
src/pages/2026/my-image-post/
├── index.md
└── example.png
```

Use the `image-post.njk` layout in `index.md` and a relative image path:

```markdown
---
title: An image post
date: 2026-10-02
layout: image-post.njk
image: example.png
imageAlt: "A description of the image."
imageWidth: 880
imageHeight: 1184
---
Your note goes here. Markdown formatting is supported.
```

Use the image's actual dimensions (or omit both dimension fields).
The post appears on the home page automatically. Clicking the image opens
the original file. The year and directory name determine the page URL (for example,
`/2026/my-image-post/`). Referenced post images are copied alongside the generated
page, while `src/assets/` is reserved for shared site assets such as CSS.

## Observable Plot charts

Keep each chart's browser entry point in `chart.ts` beside its page. Eleventy
bundles these entries with esbuild during both production builds and preview
builds. Load `/assets/charts/<page-directory-name>.js` with
`<script type="module">`. Page directory names must be unique across charts.
All entries are bundled together, so future charts share dependency chunks.
Only `chart.ts` is a browser entry point; extraction scripts are not bundled
or published. Adjacent `data.json` files are published alongside their pages.

### Updating kernel CVE counts

The extraction script lives at
`src/pages/2026/kernel-cve-fixes/update-data.ts`. After a new mainline release:

```sh
npm ci
npm run update:kernel-cves -- --through 7.3
npm run typecheck
npm test
npm run build
```

Choose the last completed mainline release for `--through`. The script updates
its private upstream clone under
`${XDG_CACHE_HOME:-$HOME/.cache}/kernel-cve-fixes/vulns` and regenerates
`src/pages/2026/kernel-cve-fixes/data.json`. Review and commit that file:
historical counts may change as upstream records are revised or rejected.
The JSON records the source commit and its timestamp, not the time of the local
build. Site builds use the checked-in data and never fetch upstream.

To reproduce a specific snapshot, use a clean upstream checkout at that commit:

```sh
npm run update:kernel-cves -- --through 7.2 --repo /path/to/vulns
```

`--repo` reads the checkout without fetching or moving its HEAD. CVEs are
counted once per release from published records' `.dyad` fix versions; patch
backports are excluded and release candidates are grouped with their eventual
mainline release. The explicit cutoff keeps unfinished releases off the chart.
