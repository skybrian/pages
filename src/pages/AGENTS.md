# Page authoring

These conventions apply to pages under `src/pages/`. See [development and maintenance](../../DEVELOPMENT.md)
for development commands, preview tools, and build/runtime architecture.

## Page locations and URLs

Put pages under their year in `src/pages/`, for example:

- `src/pages/2026/anthropic-run-rates.html` → `/2026/anthropic-run-rates/`
- `src/pages/2026/my-image-post/index.md` → `/2026/my-image-post/`

The URL follows the source directory, not the post date. Start a new year by
creating `src/pages/2027/`; no configuration change is needed. The homepage
lists pages from all years. Year archive indexes are not generated automatically.

## Image posts

Give each post a directory in `src/pages/<year>/`, with its image next to `index.md`:

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
See the editorial conventions below for how to use the description and body.
Chart directory names may be reused across years or parent directories;
generated assets stay with each page.

`chart.ts` default-exports a definition; it does not fetch data or mount itself.
Adjust this example's relative import for pages nested more deeply:

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

## Editorial conventions

Avoid repeating information across page titles, subtitles, chart labels, and
body text. Use chart-page `description` for metadata and homepage summaries,
not an automatic visible subtitle. Body text should add context, sources,
methodology, or caveats rather than restate the chart. Preserve unique details
and keep labels and accessible descriptions needed to understand charts on
their own (including exported images).

## Tests and validation

Page-specific tests may live in a page's `tests/` directory. Test chart rendering,
data validation, assets, page structure, and accessibility—not specific wording,
source URLs, titles, or other editorial values in live page Markdown (including
front matter and rendered HTML). Markdown copy must remain editable without
requiring test changes. Test metadata propagation and Markdown rendering with
test-owned fixtures instead; `tests/chart-page-template.test.ts` is an example.
Chart labels and accessible descriptions defined in renderer code may still be
tested.

For chart changes, keep static and browser-enhanced rendering consistent; see
existing page-local chart tests and `tests/helpers/static-chart.ts` for the shared
parity helper. Preserve labels and accessible descriptions in standalone exports.

Run `npm run typecheck`, `npm test`, and `npm run build` when adding a page or
changing its rendering. Review the rendered page and chart/image output as well.
