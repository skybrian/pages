import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import os from "node:os";
import { build } from "esbuild";
import { tsImport } from "tsx/esm/api";
import { JSDOM } from "jsdom";
import sharp from "sharp";

/** @param {string} directory @returns {Promise<Array<[string, string]>>} */
async function findChartEntries(directory) {
  const entries = [];
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, item.name);
    if (item.isDirectory()) entries.push(...await findChartEntries(path));
    else if (item.isFile() && item.name === "chart.ts") {
      /** @type {[string, string]} */
      const entry = [basename(directory), path];
      entries.push(entry);
    }
  }
  return entries;
}

export async function buildChartBundles({ pagesDirectory = resolve("src/pages"), siteOutputDirectory = "_site", outputMode = "fs" } = {}) {
  if (outputMode !== "fs") return;
  const entries = await findChartEntries(pagesDirectory);
  const outputDirectory = resolve(siteOutputDirectory, "assets/charts");
  await rm(outputDirectory, { recursive: true, force: true });
  if (!entries.length) return;
  await mkdir(outputDirectory, { recursive: true });
  const names = entries.map(([name]) => name);
  if (new Set(names).size !== names.length) throw new Error(`Chart page directory names must be unique: ${names.join(", ")}`);

  const entryDirectory = await mkdtemp(join(os.tmpdir(), "chart-entries-"));
  /** @type {Record<string, string>} */
  const entryPoints = {};
  try {
    for (const [name, chartPath] of entries) {
      const pageDirectory = dirname(chartPath);
      /** @type {{ default: any }} */
      const loaded = await tsImport(pathToFileURL(resolve(chartPath)).href, import.meta.url);
      const definition = loaded.default?.default ?? loaded.default;
      if (!definition || typeof definition.parseData !== "function" || !Array.isArray(definition.charts) || !definition.charts.length) {
        throw new Error(`${chartPath} must default-export a chart definition.`);
      }
      const data = definition.parseData(JSON.parse(await readFile(join(pageDirectory, "data.json"), "utf8")));
      const preview = definition.charts.find(/** @param {any} chart */ (chart) => chart.id === (definition.previewChart ?? definition.charts[0].id));
      if (!preview) throw new Error(`${chartPath} has an invalid previewChart.`);
      const dom = new JSDOM("<!doctype html><html><body></body></html>");
      let png;
      try {
        const svg = preview.render(data, { document: dom.window.document, width: 1200, height: 630, mode: "preview" });
        if (svg.namespaceURI !== "http://www.w3.org/2000/svg") throw new Error(`${chartPath} preview must return an SVG element.`);
        svg.setAttribute("xmlns", "http://www.w3.org/2000/svg");
        if (!svg.hasAttribute("viewBox")) svg.setAttribute("viewBox", "0 0 1200 630");
        png = await sharp(Buffer.from(svg.outerHTML)).flatten({ background: "#ffffff" }).resize(1200, 630, { fit: "contain", background: "#ffffff" }).png().toBuffer();
      } finally {
        dom.window.close();
      }
      await writeFile(join(outputDirectory, `${name}.png`), png);
      const entry = join(entryDirectory, `${name}.ts`);
      await writeFile(entry, `import definition from ${JSON.stringify(resolve(chartPath))};\nimport { mountChartPage } from ${JSON.stringify(resolve("src/charts/runtime.ts"))};\nmountChartPage(definition);\n`);
      entryPoints[name] = entry;
    }
    await build({ entryPoints, outdir: outputDirectory, entryNames: "[name]", chunkNames: "chunks/[name]-[hash]", bundle: true, splitting: true, format: "esm", platform: "browser", target: "es2020" });
  } finally {
    await rm(entryDirectory, { recursive: true, force: true });
  }
}
