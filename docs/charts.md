# Charts

See [Pages](pages.md) for URL conventions and [Testing](testing.md) for
chart parity checks and validation.

## Authoring

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
See the [editorial conventions](pages.md#editorial-conventions) for how to use
the description and body.
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

## Responsive rendering

Chart pages include build-time inline SVGs, with compact, medium, and wide
layouts selected by CSS container queries. JavaScript uses the same sizing tiers
to add interactivity without changing the chart's fonts or geometry on load.
Each page's `chart.png` is for social-sharing previews only. Keep the
container-query thresholds in `src/assets/style.css` aligned with
`src/charts/sizing.js`.

## Browser bundles and dependencies

Each chart's browser entry is bundled independently as `chart.js` beside its
generated HTML and `data.json`, including the small shared runtime but not Plot
or D3. Chart pages load locally hosted, versioned UMD
distributions (D3 first, then Plot); browser-only esbuild aliases connect normal
package imports to those globals. Node rendering and TypeScript continue to use
the npm packages. The build copies vendor files and licenses from the installed
packages and derives their URLs from the installed versions, keeping browser
code, rendering, and types in sync. Plot and D3 are pinned in `package.json`;
upgrading a package and its lockfile updates its browser filename automatically.

## Build and runtime

The shared runtime fetches and validates JSON once, handles loading/errors and
responsive redraws, and shows keyboard-accessible tabs only when there is more
than one chart. Tab IDs are reflected in the URL fragment (for example `#shares`).
The shared Copy SVG button exports the currently selected chart.
The JSON schema is page-specific; multiple chart views share the same dataset.

During builds, Eleventy bundles generated browser entry points with esbuild and
publishes adjacent `data.json` files. The build also calls the designated chart's
renderer using JSDOM in `preview` mode and rasterizes it with Sharp into a
1200×630 `chart.png` beside the page's HTML, `chart.js`, and `data.json`. The initial HTML points
Open Graph metadata at this image's absolute production URL. Each page has one
social image, regardless of the selected tab; fragments do not select a different
social card. Invalid data or a broken preview fails the build. Builds use checked-in
data and do not fetch external sources or require a browser.

Chart rendering runs in a disposable worker per build. All chart imports share
one TypeScript loader and dependency cache within that worker; terminating it
after asset generation releases the cache and loader hooks. The next preview
rebuild loads fresh chart code and transitive dependencies, without accumulating
loader overhead in the preview server.
