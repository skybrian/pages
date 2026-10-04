# Pages

One-off pages and charts for https://pages.skybrian.com.

## Development checks

Run `npm run typecheck` to check TypeScript and JavaScript types without
emitting files. To run the build, use `npm run build`.

When running the preview server with `npm run dev`, open
`/admin/files/` to browse the current worktree. Preview output goes to `_preview/`,
separate from production builds in `_site/`, so running `npm run build` does not
remove the preview ribbon or overwrite the served pages. This browser is registered only
in Eleventy's serve mode; production builds do not emit admin pages or editor
assets. It blocks symlinks rather than following them. Detected UTF-8 text
files are displayed as escaped text in a separate HTML page; binary, invalid
UTF-8, and non-regular files are not linked. Text previews are limited to
1 MiB. Valid PNG files up to 10 MiB are served as images and their links open
in a new browser tab; PNG content is checked rather than trusting the filename.
Other binary files and files exceeding their limits are not previewed or served.
Supported source extensions are syntax highlighted with MicroLighter;
unrecognized text extensions remain plain text.

Existing `.md` and `.markdown` files have an **Edit** button. The preview-only
CodeMirror 6 editor is bundled locally with esbuild and provides Markdown
highlighting, line wrapping, undo/redo, and search. Saving is always explicit
(Save or Ctrl/Cmd-S); there is no autosave or rendered Markdown preview in the
editor. UTF-8 BOMs and uniform LF/CRLF line endings are retained. Files with
mixed line endings cannot be saved here; normalize them externally first.
Saves are limited to 1 MiB, require the page's same-origin CSRF token,
and use a content hash to reject stale edits instead of overwriting concurrent
changes. Saves in the preview process are serialized per canonical file path,
and the current hash is checked again immediately before replacement.
Replacement is atomic. This prevents concurrent editor saves in this server
from both succeeding and narrows races with external writers; a separate
process can still write in the small interval between the final hash check and
filesystem rename because ordinary path-based filesystem APIs do not provide
a cross-process compare-and-swap. If a dev-server reload or navigation is
attempted with edits, the browser warns; the tab also keeps a session-only draft
so an accepted live reload can restore the unsaved text. The draft records the
source hash it was based on; drafts from stale or unknown versions are
preserved but cannot be saved until explicitly reloaded. Cancel discards it.
If another process changes the file, the editor preserves the draft and offers
an explicit reload-from-disk action.

For a quick workflow check, run `npm run dev`, open a Markdown source page from
`/admin/files/`, enter Edit, make a change, and use Save. Verify a second edit
followed by Cancel restores the saved source, and that an external edit causes
a conflict rather than silent replacement. The ordinary file view and the
generated page's Source ribbon remain available.

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

## Chart pages

Each chart page lives in a directory under `src/pages/<year>/`:

```text
my-chart/
├── index.md       # Page metadata and explanatory Markdown
├── data.json      # Published data (and, optionally, provenance)
└── chart.ts       # Chart definitions, validation, and SVG rendering
```

Use `layout: chart-page.njk` in the Markdown front matter, along with `title`,
`date`, and optionally `description`. The shared layout provides the chart panel,
Markdown content, a JSON link opening in a new tab, and social-image metadata.
The description is used for metadata and homepage summaries, not displayed as
a subtitle. Use the Markdown body for context, sources, methodology, and caveats
without repeating the heading or chart labels.
URLs remain based on the year and directory name. Chart directory names must be
unique across years because generated assets use the directory name.

`chart.ts` default-exports a definition; it does not fetch data or mount itself:

```ts
import { defineChartPage } from "../../../charts/definition.ts";

export default defineChartPage<Dataset>({
  parseData(value: unknown): Dataset {
    // Validate the page-specific JSON shape, throwing on invalid input.
    return validateDataset(value);
  },
  charts: [
    {
      id: "counts",
      label: "Counts",
      alt: "A description of what this chart shows.",
      render(data, { document, width, height, mode }) {
        return renderCounts(data, {
          document, width, height, interactive: mode === "interactive",
        });
      },
    },
  ],
  previewChart: "counts", // Optional; defaults to the first chart.
});
```

Renderers must return an `SVGSVGElement` and use the supplied `document`, not a
browser-global document. They may use Observable Plot or construct SVG directly.
Keep browser side effects and Node-only imports out of the chart definition.
Additional renderer modules and private data-update scripts may live alongside it;
only the chart entry and its imports are bundled for the browser.

The shared runtime fetches and validates JSON once, handles loading/errors and
responsive redraws, and shows keyboard-accessible tabs only when there is more
than one chart. Tab IDs are reflected in the URL fragment (for example `#shares`).
The shared Copy SVG button exports the currently selected chart.
The JSON schema is page-specific; multiple chart views share the same dataset.

During builds, Eleventy bundles generated browser entry points with esbuild and
publishes adjacent `data.json` files. The build also calls the designated chart's
renderer using JSDOM in `preview` mode and rasterizes it with Sharp into a
1200×630 PNG at `/assets/charts/<page-directory-name>.png`. The initial HTML points
Open Graph metadata at this image's absolute production URL. Each page has one
social image, regardless of the selected tab; fragments do not select a different
social card. Invalid data or a broken preview fails the build. Builds use checked-in
data and do not fetch external sources or require a browser.

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
