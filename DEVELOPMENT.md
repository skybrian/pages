# Development and maintenance

## Development checks

Run `npm run typecheck` to check TypeScript and JavaScript types without
emitting files. To run the build, use `npm run build`.

Chart pages include build-time inline SVGs, with compact, medium, and wide
layouts selected by CSS container queries. JavaScript uses the same sizing tiers
to add interactivity without changing the chart's fonts or geometry on load.
Each page's `chart.png` is for social-sharing previews only. Keep the
container-query thresholds in `src/assets/style.css` aligned with
`src/charts/sizing.js`.

Each chart's browser entry is bundled independently as `chart.js` beside its
generated HTML and `data.json`, including the small shared runtime but not Plot
or D3. Chart pages load locally hosted, versioned UMD
distributions (D3 first, then Plot); browser-only esbuild aliases connect normal
package imports to those globals. Node rendering and TypeScript continue to use
the npm packages. The build copies vendor files and licenses from the installed
packages and derives their URLs from the installed versions, keeping browser
code, rendering, and types in sync. Plot and D3 are pinned in `package.json`;
upgrading a package and its lockfile updates its browser filename automatically.

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

Eleventy does not remove previously generated files when their sources are
deleted or excluded. If an obsolete page remains available in preview, stop
the preview server, remove that page's generated output from `_preview/`, and
restart the server. Agent guidance files under `src/pages/` are excluded from
page generation.

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
rendering Preact children as complete HTML documents. Shared tests live in
`tests/`, preview tests in `preview/`, and page-specific tests can live under
`src/pages/<year>/<page>/tests/` (including nested test files). `npm test`
recursively discovers `.test.ts` and `.test.tsx` entry points in those
locations; helpers and fixture directories are not run as tests. Page test
directories are excluded from generated pages and passthrough assets.

`npm test` creates one isolated site build and shares its output with every
test process, then removes it even if building or testing fails. Test-runner
arguments are forwarded (for example, `npm test -- --test-name-pattern="URLs"`).
For a focused file run, invoke this from the repository root:
`node --import tsx --test path/to/test.test.ts`; site-output tests lazily build
their own private output and remove it when the test process finishes.

Enable the pre-commit typecheck hook for this worktree with:

```sh
git config --local core.hooksPath .githooks
```

The hook checks the working tree, not just the staged snapshot. You can bypass
it for a commit with `git commit --no-verify`.

## Page URLs and archives

Page-authoring recipes and URL conventions are in
[`src/pages/AGENTS.md`](src/pages/AGENTS.md). That guide covers image-post front
matter, chart definitions, editorial conventions, and page testing.

Permanent redirects for the original, yearless URLs are maintained in
`src/_redirects`, which is copied into the build output for Netlify. These
also preserve direct image links. Netlify handles these redirects in production;
the local Eleventy preview does not apply them.

## Chart build and runtime

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
