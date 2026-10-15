# Page authoring

For changes under `src/pages/`, read [Pages](../../docs/pages.md) and the relevant
[Image posts](../../docs/image-posts.md) or [Charts](../../docs/charts.md) guide.
Read [Testing](../../docs/testing.md) when changing tests or rendering.

Do not assert specific wording, source URLs, titles, or other editorial values
from live page Markdown in tests. Use test-owned fixtures instead.

When adding a page or changing rendering, run `npm run typecheck`, `npm test`,
and `npm run build`. Review the rendered page and chart/image output as well.
