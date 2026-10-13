import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { it } from "node:test";

const execFileAsync = promisify(execFile);
const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p8sAAAAASUVORK5CYII=",
  "base64",
);

it("excludes page-local test fixtures from real production output without dropping page assets", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "pages-fixture-exclusion-"));
  try {
    await Promise.all(["node_modules", "scripts", "preview"].map((name) =>
      symlink(path.join(repositoryRoot, name), path.join(root, name), "dir")));
    await writeFile(path.join(root, "package.json"), JSON.stringify({ type: "module" }));
    await writeFile(path.join(root, "eleventy.config.js"), await readFile(
      path.join(repositoryRoot, "eleventy.config.js"), "utf8",
    ));

    const pages = path.join(root, "src/pages/2026");
    const ordinaryPage = path.join(pages, "example");
    const nestedPage = path.join(pages, "nested/deeper/example");
    const fixtures = path.join(ordinaryPage, "tests/fixtures");
    await Promise.all([
      mkdir(ordinaryPage, { recursive: true }),
      mkdir(nestedPage, { recursive: true }),
      mkdir(fixtures, { recursive: true }),
      mkdir(path.join(root, "src/assets"), { recursive: true }),
    ]);
    await writeFile(path.join(root, "src/_redirects"), "");
    await writeFile(path.join(root, "src/pages/AGENTS.md"), "# Page authoring guidance\n");
    await writeFile(path.join(ordinaryPage, "AGENTS.md"), "# Local authoring guidance\n");
    await writeFile(path.join(ordinaryPage, "index.md"), [
      "---", "permalink: /example/index.html", "---",
      "", "![page image](photo.png)", "", "[page data](data.json)", "",
      "![fixture image](tests/fixtures/photo.png)", "",
      "[fixture data](tests/fixtures/data.json)", "",
    ].join("\n"));
    await writeFile(path.join(ordinaryPage, "photo.png"), png);
    await writeFile(path.join(ordinaryPage, "data.json"), '{"page":"ordinary"}\n');
    await writeFile(path.join(nestedPage, "index.md"), [
      "---", "permalink: /nested/deeper/example/index.html", "---",
      "", "![nested image](photo.png)", "", "[nested data](data.json)", "",
    ].join("\n"));
    await writeFile(path.join(nestedPage, "photo.png"), png);
    await writeFile(path.join(nestedPage, "data.json"), '{"page":"nested"}\n');

    await writeFile(path.join(fixtures, "index.md"), [
      "---", "permalink: /leaked/index.html", "---", "", "Fixture page must not publish.", "",
    ].join("\n"));
    await writeFile(path.join(fixtures, "chart.ts"), 'throw new Error("fixture chart was bundled");\n');
    await writeFile(path.join(fixtures, "photo.png"), png);
    await writeFile(path.join(fixtures, "data.json"), '{"fixture":true}\n');

    const output = path.join(root, "production-output");
    await execFileAsync(process.execPath, [
      path.join(repositoryRoot, "node_modules/@11ty/eleventy/cmd.cjs"),
      `--output=${output}`,
    ], {
      cwd: root,
      env: { ...process.env, ELEVENTY_RUN_MODE: "build" },
    });
    for (const [relativeDirectory, expectedData] of [
      ["example", '{"page":"ordinary"}\n'],
      ["nested/deeper/example", '{"page":"nested"}\n'],
    ]) {
      assert.deepEqual(
        await readFile(path.join(output, relativeDirectory, "photo.png")),
        png,
        `${relativeDirectory}: preserve ordinary page image passthrough`,
      );
      assert.equal(
        await readFile(path.join(output, relativeDirectory, "data.json"), "utf8"),
        expectedData,
        `${relativeDirectory}: preserve ordinary page data passthrough`,
      );
    }

    await assert.rejects(
      readFile(path.join(output, "example/tests/fixtures/photo.png")),
      { code: "ENOENT" },
    );
    await assert.rejects(
      readFile(path.join(output, "example/tests/fixtures/data.json")),
      { code: "ENOENT" },
    );
    await assert.rejects(
      readFile(path.join(output, "example/tests/fixtures/index.html")),
      { code: "ENOENT" },
    );
    await assert.rejects(
      stat(path.join(output, "example/tests")),
      { code: "ENOENT" },
    );
    await assert.rejects(
      readFile(path.join(output, "leaked/index.html")),
      { code: "ENOENT" },
    );
    for (const guidancePage of ["pages/AGENTS/index.html", "pages/2026/example/AGENTS/index.html"]) {
      await assert.rejects(readFile(path.join(output, guidancePage)), { code: "ENOENT" });
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
