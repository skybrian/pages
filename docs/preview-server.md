# Preview server

## Running preview and browsing files

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

## Stale output

Eleventy does not remove previously generated files when their sources are
deleted or excluded. If an obsolete page remains available in preview, stop
the preview server, remove that page's generated output from `_preview/`, and
restart the server. Agent guidance files under `src/pages/` are excluded from
page generation.

## Markdown editor

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

## Preview-only pages

Preview-only server-rendered pages can be authored as `.tsx` files under
`preview/`. The preview config loads their TypeScript entry points with the
scoped `tsx` loader, and `preview/render.tsx` provides `renderDocument()` for
rendering Preact children as complete HTML documents.

See [Testing](testing.md) for preview test discovery and the opt-in watch test.
