import assert from "node:assert/strict";
import { mkdtemp, mkdir, rename, rm, writeFile } from "node:fs/promises";
import { once } from "node:events";
import os from "node:os";
import path from "node:path";
import chokidar from "chokidar";
import { after, describe, it } from "node:test";
import { getMarkdownWatchTargets } from "./markdown-watch.js";

const temporaryRoots: string[] = [];

after(async () => {
  await Promise.all(temporaryRoots.map((root) => rm(root, { recursive: true, force: true })));
});

describe("Markdown preview watch targets", () => {
  it("watches existing Markdown files alongside Eleventy's overlapping source globs", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "markdown-watch-"));
    temporaryRoots.push(root);
    const pageDirectory = path.join(root, "src/pages/2026/sample");
    await mkdir(pageDirectory, { recursive: true });
    await writeFile(path.join(pageDirectory, "index.md"), "# before\n");
    await writeFile(path.join(pageDirectory, "chart.ts"), "export {};\n");
    await writeFile(path.join(pageDirectory, "data.json"), "{}\n");

    const target = path.join(pageDirectory, "index.md");
    const relativeTarget = "src/pages/2026/sample/index.md";
    const overlappingGlobs = [
      "src",
      "scripts/build-charts.js",
      "./package.json",
      "./src/pages/**/*.ts",
      "./src/pages/**/data.json",
      "./src/charts/**/*.ts",
      "./src/**/*.{md,njk,html}",
      "./src/assets/**",
      "./src/_redirects",
      "./src/_includes/**",
      "./src/_data/**",
      "./.gitignore",
      "./.eleventyignore",
      "./src/.eleventyignore",
      "./.eleventy.js",
      "./eleventy.config.js",
      "./eleventy.config.mjs",
      "./eleventy.config.cjs",
      "./src/**/*.{json,11tydata.mjs,11tydata.cjs,11tydata.js}",
    ];
    const options = {
      cwd: root,
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 150, pollInterval: 25 },
      ignored: ["node_modules/**", "_site", ".DS_Store", "_site/**", "**/node_modules/**", "./.git/**"],
    };

    const baseline = chokidar.watch(overlappingGlobs, options);
    await once(baseline, "ready");
    const baselineChanges: string[] = [];
    baseline.on("change", (file) => baselineChanges.push(file));
    await atomicReplace(target, "# baseline replacement\n");
    await new Promise((resolve) => setTimeout(resolve, 500));
    assert.deepEqual(
      baselineChanges,
      [],
      "the overlapping glob set reproduces Chokidar 3 omitting existing Markdown files",
    );
    await baseline.close();

    await writeFile(target, "# before\n");
    const targets = await getMarkdownWatchTargets(path.join(root, "src"), root);
    assert.deepEqual(targets, [relativeTarget]);
    const fixed = chokidar.watch([...overlappingGlobs, ...targets], options);
    await once(fixed, "ready");
    const changed = once(fixed, "change");
    await atomicReplace(target, "# fixed replacement\n");
    const [changedPath] = await Promise.race([
      changed,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Markdown change was not observed")), 2000)),
    ]);
    assert.equal(changedPath, relativeTarget);
    await fixed.close();
  });
});

async function atomicReplace(target: string, content: string) {
  const temporary = path.join(path.dirname(target), `.${path.basename(target)}.test.tmp`);
  await writeFile(temporary, content);
  await rename(temporary, target);
}
