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
function plainDefinition(ids: string[]): string {
  const charts = ids.map((id) =>
    `{ id: ${JSON.stringify(id)}, label: ${JSON.stringify(id)}, alt: ${JSON.stringify(`${id} chart`)}, render }`,
  ).join(", ");
  return `
    const render = (data, {document, width, height}) => {
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("viewBox", "0 0 " + width + " " + height);
      return svg;
    };
    export default {
      parseData(value) { if (!Array.isArray(value)) throw new Error("invalid"); return value; },
      charts: [${charts}],
      previewChart: ${JSON.stringify(ids[0])}
    };
  `;
}
const basePageHtml = `<!doctype html><html><head></head><body>
  <div data-chart-tabs></div><div data-chart-root></div>
  <script type="module" src="./chart.js"></script>
</body></html>`;

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
      const files = [...await walk(path.join(output, "alpha")), ...await walk(path.join(output, "beta"))];
      for (const page of ["alpha", "beta"]) {
        assert.deepEqual((await readdir(path.join(output, page))).sort(), ["chart.js", "chart.png"]);
      }
      assert.ok((await readFile(path.join(output, "alpha", "chart.png"))).subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])));
      assert.ok(files.every((file) => !file.endsWith(".ts")));
      assert.equal(files.length, 4, "each page owns its bundle and social-preview image");
      await assert.rejects(readdir(path.join(output, "assets", "charts")), { code: "ENOENT" });
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
      assert.deepEqual((await readdir(pageOutput)).sort(), ["chart.js", "chart.png", "data.json", "index.html"]);
      assert.equal(await readFile(path.join(pageOutput, "index.html"), "utf8"), "<h1>Example</h1>");
      assert.equal(await readFile(path.join(pageOutput, "data.json"), "utf8"), "[]");
      await assert.rejects(readFile(path.join(output, "assets/charts/example.js")));
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it("supports the same chart directory name under different parents and removes legacy shared assets", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "chart-bundles-"));
    const pages = path.join(root, "pages");
    const output = path.join(root, "out");
    try {
      for (const parent of ["first", "second"]) {
        const page = path.join(pages, parent, "same-name");
        await mkdir(page, { recursive: true });
        await writeFile(path.join(page, "chart.ts"), definition);
        await writeFile(path.join(page, "data.json"), "[]");
      }
      await mkdir(path.join(output, "assets", "charts"), { recursive: true });
      await writeFile(path.join(output, "assets", "charts", "same-name.png"), "obsolete");
      await buildChartBundles({ pagesDirectory: pages, siteOutputDirectory: output });
      for (const parent of ["first", "second"]) {
        assert.deepEqual((await readdir(path.join(output, parent, "same-name"))).sort(), ["chart.js", "chart.png"]);
      }
      await assert.rejects(readdir(path.join(output, "assets", "charts")), { code: "ENOENT" });
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
      await assert.rejects(readdir(path.join(output, "broken")), { code: "ENOENT" });
      await assert.rejects(readdir(path.join(output, "assets", "charts")), { code: "ENOENT" });
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it("rejects unsafe or duplicate IDs in plain definitions before writing escaped views", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "chart-bundles-"));
    const pages = path.join(root, "pages");
    const output = path.join(root, "out");
    const escapedIndex = path.resolve(output, "page", "../../escape", "index.html");
    try {
      const page = path.join(pages, "page");
      await mkdir(page, { recursive: true });
      await writeFile(path.join(page, "chart.ts"), plainDefinition(["../../escape", "safe"]));
      await writeFile(path.join(page, "data.json"), "[]");
      await mkdir(path.join(output, "page"), { recursive: true });
      await writeFile(path.join(output, "page", "index.html"), basePageHtml);
      await assert.rejects(
        buildChartBundles({ pagesDirectory: pages, siteOutputDirectory: output }),
        /unsafe\/duplicate chart id/,
      );
      await assert.rejects(readFile(escapedIndex), { code: "ENOENT" });

      await writeFile(path.join(page, "chart.ts"), plainDefinition(["same", "same"]));
      await assert.rejects(
        buildChartBundles({ pagesDirectory: pages, siteOutputDirectory: output }),
        /unsafe\/duplicate chart id/,
      );
      await assert.rejects(readFile(escapedIndex), { code: "ENOENT" });
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it("protects authored output indexes and only overwrites marked generated variants", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "chart-view-ownership-"));
    const pages = path.join(root, "pages");
    const output = path.join(root, "out");
    const page = path.join(pages, "page");
    const pageOutput = path.join(output, "page");
    try {
      await mkdir(page, { recursive: true });
      await writeFile(path.join(page, "chart.ts"), plainDefinition(["first", "second"]));
      await writeFile(path.join(page, "data.json"), "[]");
      await mkdir(pageOutput, { recursive: true });
      await writeFile(path.join(pageOutput, "index.html"), basePageHtml);
      await buildChartBundles({ pagesDirectory: pages, siteOutputDirectory: output });
      const firstView = path.join(pageOutput, "first", "index.html");
      const generatedMarkup = await readFile(firstView, "utf8");
      assert.match(generatedMarkup, /data-chart-view-owner="page\/first"/);

      await buildChartBundles({ pagesDirectory: pages, siteOutputDirectory: output });
      assert.match(await readFile(firstView, "utf8"), /data-chart-view-owner="page\/first"/,
        "a marked generated view can be rebuilt");

      const authoredPath = path.join(pageOutput, "second", "index.html");
      const authoredMarkup = "<!doctype html><html><body>authored page</body></html>";
      await writeFile(authoredPath, authoredMarkup);
      await assert.rejects(
        buildChartBundles({ pagesDirectory: pages, siteOutputDirectory: output }),
        /already exists and is not a generated chart view/,
      );
      assert.equal(await readFile(authoredPath, "utf8"), authoredMarkup,
        "an existing authored output index must not be overwritten");

      const nestedPages = path.join(root, "nested-pages");
      const nestedOutput = path.join(root, "nested-out");
      const nestedPage = path.join(nestedPages, "page");
      const authoredDirectory = path.join(nestedPage, "safe");
      const authoredSource = path.join(authoredDirectory, "index.md");
      await mkdir(authoredDirectory, { recursive: true });
      await writeFile(authoredSource, "# Authored child page\n");
      await writeFile(path.join(nestedPage, "chart.ts"), plainDefinition(["first", "safe"]));
      await writeFile(path.join(nestedPage, "data.json"), "[]");
      await mkdir(path.join(nestedOutput, "page"), { recursive: true });
      await writeFile(path.join(nestedOutput, "page", "index.html"), basePageHtml);
      await assert.rejects(
        buildChartBundles({ pagesDirectory: nestedPages, siteOutputDirectory: nestedOutput }),
        /collides with an authored source path/,
      );
      assert.equal(await readFile(authoredSource, "utf8"), "# Authored child page\n");
      await assert.rejects(readFile(path.join(nestedOutput, "page", "safe", "index.html")), { code: "ENOENT" });
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
