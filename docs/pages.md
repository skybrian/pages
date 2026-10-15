# Pages

These conventions apply to pages under `src/pages/`. See the recipes for
[image posts](image-posts.md) and [chart pages](charts.md), and the
[testing guide](testing.md) for validation.

## Page locations and URLs

Put pages under their year in `src/pages/`, for example:

- `src/pages/2026/anthropic-run-rates.html` → `/2026/anthropic-run-rates/`
- `src/pages/2026/my-image-post/index.md` → `/2026/my-image-post/`

The URL follows the source directory, not the post date. Start a new year by
creating `src/pages/2027/`; no configuration change is needed. The homepage
lists pages from all years. Year archive indexes are not generated automatically.

## Editorial conventions

Set an optional `updated: YYYY-MM-DD` front-matter field to append
“· updated YYYY-MM-DD” to the homepage date row. Keep `date` as the original
publication date; `updated` does not affect the homepage sort order.

Avoid repeating information across page titles, subtitles, chart labels, and
body text. Use chart-page `description` for metadata and homepage summaries,
not an automatic visible subtitle. Body text should add context, sources,
methodology, or caveats rather than restate the chart. Preserve unique details
and keep labels and accessible descriptions needed to understand charts on
their own (including exported images).

## Redirects

Permanent redirects for the original, yearless URLs are maintained in
`src/_redirects`, which is copied into the build output for Netlify. These
also preserve direct image links. Netlify handles these redirects in production;
the local Eleventy preview does not apply them.
