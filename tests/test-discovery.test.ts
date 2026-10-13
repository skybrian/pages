import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import { discoverTestFiles } from "../scripts/run-tests.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function makeRoot() {
  const root = await mkdtemp(join(tmpdir(), "pages-test-discovery-"));
  temporaryRoots.push(root);
  return root;
}

async function touch(root: string, path: string) {
  const file = join(root, path);
  await mkdir(join(file, ".."), { recursive: true });
  await writeFile(file, "// isolated discovery fixture\n");
}

test("discovers shared and nested page test entry points, not helpers or fixtures", async () => {
  const root = await makeRoot();
  for (const file of [
    "preview/current.test.ts",
    "preview/nested/future.test.tsx",
    "preview/helper.ts",
    "tests/shared.test.ts",
    "tests/helper.ts",
    "tests/fixtures/example.test.ts",
    "src/pages/2026/example/tests/page.test.ts",
    "src/pages/2026/example/tests/nested/another.test.tsx",
    "src/pages/2026/example/tests/helper.ts",
    "src/pages/2026/example/tests/__fixtures__/fixture.test.ts",
    "src/pages/2026/example/test-data.test.ts",
    "src/pages/2026/nested/category/example/tests/deep.test.ts",
    "src/pages/2026/other/index.md",
  ]) {
    await touch(root, file);
  }

  const files = (await discoverTestFiles(root)).map((file) => file.slice(root.length + 1));
  assert.deepEqual(files, [
    "preview/current.test.ts",
    "preview/nested/future.test.tsx",
    "src/pages/2026/example/tests/nested/another.test.tsx",
    "src/pages/2026/example/tests/page.test.ts",
    "src/pages/2026/nested/category/example/tests/deep.test.ts",
    "tests/shared.test.ts",
  ].sort());
});

test("an empty or partial fixture tree is supported", async () => {
  const root = await makeRoot();
  assert.deepEqual(await discoverTestFiles(root), []);
  await touch(root, "src/pages/2026/page/tests/only.test.ts");
  assert.deepEqual((await discoverTestFiles(root)).map((file) => file.slice(root.length + 1)), [
    "src/pages/2026/page/tests/only.test.ts",
  ]);
});
