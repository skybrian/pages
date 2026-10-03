import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { buildChartBundles } from "../scripts/build-charts.js";

async function walk(directory: string): Promise<string[]> {
  const files: string[] = [];
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, item.name);
    if (item.isDirectory()) files.push(...await walk(file));
    else files.push(file);
  }
  return files;
}

describe("chart bundles", () => {
  it("writes stable ESM entries and shared hashed chunks only to the configured output", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "chart-bundles-"));
    const pages = path.join(root, "pages");
    const output = path.join(root, "custom-output");
    try {
      await mkdir(path.join(pages, "alpha"), { recursive: true });
      await mkdir(path.join(pages, "beta"), { recursive: true });
      await writeFile(path.join(pages, "shared.js"), "export const shared = 'shared code';\n");
      for (const page of ["alpha", "beta"]) {
        await writeFile(
          path.join(pages, page, "chart.ts"),
          "import { shared } from '../shared.js'; console.log(shared);\n",
        );
      }
      await writeFile(path.join(pages, "update-data.ts"), "console.log('not a chart');\n");

      await buildChartBundles({ pagesDirectory: pages, siteOutputDirectory: output });

      const chartOutput = path.join(output, "assets", "charts");
      const files = await walk(chartOutput);
      assert.ok(files.includes(path.join(chartOutput, "alpha.js")));
      assert.ok(files.includes(path.join(chartOutput, "beta.js")));
      const chunks = files.filter((file) => file.includes(`${path.sep}chunks${path.sep}`));
      assert.equal(chunks.length, 1);
      assert.match(path.basename(chunks[0]!), /^chunk-[\w-]+\.js$/);
      for (const entry of ["alpha.js", "beta.js"]) {
        assert.match(await readFile(path.join(chartOutput, entry), "utf8"), /chunks\/chunk-/);
      }
      assert.ok(files.every((file) => !file.endsWith(".ts")));
      await assert.rejects(readdir(path.join(root, "_site")));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects duplicate page-directory entry names", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "chart-bundles-"));
    const pages = path.join(root, "pages");
    try {
      for (const parent of ["first", "second"]) {
        const page = path.join(pages, parent, "same-name");
        await mkdir(page, { recursive: true });
        await writeFile(path.join(page, "chart.ts"), "console.log('chart');\n");
      }

      await assert.rejects(
        buildChartBundles({ pagesDirectory: pages, siteOutputDirectory: path.join(root, "out") }),
        /Chart page directory names must be unique/,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("skips non-filesystem Eleventy output modes", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "chart-bundles-"));
    try {
      await buildChartBundles({
        pagesDirectory: path.join(root, "missing-pages"),
        siteOutputDirectory: path.join(root, "out"),
        outputMode: "json",
      });
      await assert.rejects(readdir(path.join(root, "out")));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
