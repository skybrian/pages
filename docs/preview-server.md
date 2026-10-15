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

## Markdown views

Existing `.md` and `.markdown` files have four tabs:

- **Rendered** (the default): documentation-style Markdown, including lists,
  tables, and fenced code blocks. Front matter is omitted and raw HTML is
  displayed as text rather than executed. This is a document rendering, not
  an Eleventy build; use the ribbon to open an actual generated page.
- **Source**: the saved Markdown as read-only, syntax-highlighted text.
- **Editor**: a locally bundled CodeMirror 6 editor with Markdown highlighting,
  line wrapping, undo/redo, and search. It reads the file from disk on entry.
- **Changes**: a unified diff of the saved working-tree file against Git `HEAD`,
  combining staged and unstaged changes. Untracked files appear as additions;
  Git failures and missing commits are reported without disabling editing.

Relative documentation links resolve within the file browser. Non-Markdown
files keep their existing read-only viewer. Tab navigation supports arrow keys,
Home, and End.

## Markdown editor

Edits save automatically after a short typing pause. The status distinguishes
pending changes, saving, successful saves, and failures. Ctrl/Cmd-S can request
an immediate save; search uses Ctrl/Cmd-F. Switching tabs finishes pending
saves before releasing the editor, so Source, Rendered, and Changes reflect the
saved text. Returning to Editor creates a fresh editor from disk, with a new
undo history.

A failed save or external-edit conflict keeps the editor and its text intact
and blocks switching away. Reloading from disk requires confirmation before
replacing unsaved text. Navigation or a browser reload with unsaved edits warns
rather than silently losing the text. A session-only recovery draft also
preserves pending or failed edits across an accepted reload. If its original
file version no longer matches disk, it is preserved but cannot be autosaved
over the newer version.

UTF-8 BOMs and uniform LF/CRLF line endings are retained. Files with mixed line
endings cannot be saved here; normalize them externally first. Saves are limited
to 1 MiB, require the page's same-origin CSRF token, and use a content hash to
reject stale edits rather than overwriting concurrent changes. Saves and
reverts in the preview process are serialized per canonical file path; the
current hash is checked again immediately before atomic replacement. A separate
process can still write in the small interval between the final hash check and
filesystem rename because ordinary path-based filesystem APIs do not provide
a cross-process compare-and-swap.

### Reverting changes

The **Changes** tab offers **Revert to HEAD…** when a committed version exists
and differs from the saved file. After confirmation, this replaces only that
file's working-tree contents with its version in the current `HEAD`. It does
not modify Git's index or create a commit. Staged changes therefore remain
staged, even when the working-tree file now matches `HEAD`. Files absent from
`HEAD` have no revert action. A stale file hash rejects the revert instead of
overwriting a newer external change.

For a workflow check, open a Markdown file under `/admin/files/docs/`, inspect
all four tabs, edit it, and switch to Rendered. Verify the saved result appears
in Source and Changes. Make an external edit while the editor is open and
verify that autosave reports a conflict without replacing either version.
Finally, use a disposable tracked file to verify Revert to HEAD restores its
committed contents without changing the staging area.

## Preview-only pages

Preview-only server-rendered pages can be authored as `.tsx` files under
`preview/`. The preview config loads their TypeScript entry points with the
scoped `tsx` loader, and `preview/render.tsx` provides `renderDocument()` for
rendering Preact children as complete HTML documents.

See [Testing](testing.md) for preview test discovery and the opt-in watch test.
