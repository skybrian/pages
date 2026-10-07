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
    if (item.isDirectory()) files.push(...await walk(file)); else files.push(file);
  }
  return files;
}
const definition = `export default {
  parseData(value) { if (!Array.isArray(value)) throw new Error('invalid'); return value; },
  charts: [{ id: 'main', label: 'Main', alt: 'Main chart', render(data, {document, width, height}) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 ' + width + ' ' + height);
    const text = document.createElementNS('http://www.w3.org/2000/svg', 'text'); text.textContent = String(data.length); svg.append(text); return svg;
  }}], previewChart: 'main'
};\n`;

describe("chart bundles", () => {
  it("validates data, writes browser entries and static previews only to configured output", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "chart-bundles-"));
    const pages = path.join(root, "pages");
    const output = path.join(root, "custom-output");
    try {
      for (const page of ["alpha", "beta"]) {
        await mkdir(path.join(pages, page), { recursive: true });
        await writeFile(path.join(pages, page, "chart.ts"), definition);
        await writeFile(path.join(pages, page, "data.json"), "[1,2]");
      }
      await writeFile(path.join(pages, "update-data.ts"), "console.log('not a chart');\n");
      await buildChartBundles({ pagesDirectory: pages, siteOutputDirectory: output });
      const chartOutput = path.join(output, "assets", "charts");
      const files = await walk(chartOutput);
      for (const entry of ["alpha.png", "beta.png"]) assert.ok(files.includes(path.join(chartOutput, entry)));
      for (const page of ["alpha", "beta"]) {
        assert.deepEqual(await readdir(path.join(output, page)), ["chart.js"]);
      }
      assert.ok((await readFile(path.join(chartOutput, "alpha.png"))).subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])));
      assert.ok(files.every((file) => !file.endsWith(".ts")));
      assert.equal(files.length, 2, "only social-preview images belong in shared chart assets");
      const originalAlpha = await readFile(path.join(output, "alpha", "chart.js"), "utf8");
      await writeFile(path.join(pages, "beta", "chart.ts"), definition.replace("'Main'", "'Edited beta'"));
      await mkdir(path.join(pages, "gamma"));
      await writeFile(path.join(pages, "gamma", "chart.ts"), definition);
      await writeFile(path.join(pages, "gamma", "data.json"), "[3]");
      await buildChartBundles({ pagesDirectory: pages, siteOutputDirectory: output });
      assert.equal(await readFile(path.join(output, "alpha", "chart.js"), "utf8"), originalAlpha,
        "editing or adding another page must not change an existing page's bundle");
      await assert.rejects(readdir(path.join(root, "_site")));
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it("keeps year and nested directories when placing page-local bundles", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "chart-bundles-"));
    const pages = path.join(root, "pages");
    const output = path.join(root, "out");
    try {
      const directory = path.join(pages, "2027", "nested", "example");
      await mkdir(directory, { recursive: true });
      await writeFile(path.join(directory, "chart.ts"), definition);
      await writeFile(path.join(directory, "data.json"), "[]");
      // Existing page assets must survive a chart rebuild.
      const pageOutput = path.join(output, "2027", "nested", "example");
      await mkdir(pageOutput, { recursive: true });
      await writeFile(path.join(pageOutput, "index.html"), "<h1>Example</h1>");
      await writeFile(path.join(pageOutput, "data.json"), "[]");
      await buildChartBundles({ pagesDirectory: pages, siteOutputDirectory: output });
      assert.deepEqual((await readdir(pageOutput)).sort(), ["chart.js", "data.json", "index.html"]);
      assert.equal(await readFile(path.join(pageOutput, "index.html"), "utf8"), "<h1>Example</h1>");
      assert.equal(await readFile(path.join(pageOutput, "data.json"), "utf8"), "[]");
      await assert.rejects(readFile(path.join(output, "assets/charts/example.js")));
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it("rejects duplicate page-directory entry names", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "chart-bundles-"));
    const pages = path.join(root, "pages");
    try {
      for (const parent of ["first", "second"]) {
        const page = path.join(pages, parent, "same-name");
        await mkdir(page, { recursive: true });
        await writeFile(path.join(page, "chart.ts"), definition);
        await writeFile(path.join(page, "data.json"), "[]");
      }
      await assert.rejects(buildChartBundles({ pagesDirectory: pages, siteOutputDirectory: path.join(root, "out") }), /must be unique/);
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it("rejects data that fails the page parser and does not leave a partial output", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "chart-bundles-"));
    const pages = path.join(root, "pages", "broken");
    const output = path.join(root, "out");
    try {
      await mkdir(pages, { recursive: true });
      await writeFile(path.join(pages, "chart.ts"), definition);
      await writeFile(path.join(pages, "data.json"), "{}");
      await assert.rejects(buildChartBundles({ pagesDirectory: path.join(root, "pages"), siteOutputDirectory: output }));
      assert.deepEqual(await readdir(path.join(output, "assets", "charts")), []);
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it("skips non-filesystem Eleventy output modes", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "chart-bundles-"));
    try {
      await buildChartBundles({ pagesDirectory: path.join(root, "missing"), siteOutputDirectory: path.join(root, "out"), outputMode: "json" });
      await assert.rejects(readdir(path.join(root, "out")));
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
