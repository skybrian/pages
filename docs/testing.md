# Testing and validation

## Development checks

Run these commands from the repository root:

```sh
npm run typecheck
npm test
npm run build
```

`npm run typecheck` checks TypeScript and JavaScript types without emitting
files. Run it before committing. Run `npm run build` as appropriate for changes
that affect site generation or output.

## Test discovery and isolated builds

Shared tests live in `tests/`, preview tests in `preview/`, and page-specific
tests can live under
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

The preview-watch integration test is opt-in:

```sh
npm run test:preview-watch
```

## Page and chart tests

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

## Preview editor workflow

See the [preview server guide](preview-server.md#markdown-editor) for the manual
Save, Cancel, and external-edit conflict check.

## Optional pre-commit hook

Enable the pre-commit typecheck hook for this worktree with:

```sh
git config --local core.hooksPath .githooks
```

The hook checks the working tree, not just the staged snapshot. You can bypass
it for a commit with `git commit --no-verify`.
