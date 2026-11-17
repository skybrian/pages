import { copyFile, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { build } from "esbuild";
import { register } from "tsx/esm/api";
import { parentPort } from "node:worker_threads";
import { JSDOM } from "jsdom";
import sharp from "sharp";
import { CHART_LAYOUTS, chartSize } from "../src/charts/sizing.js";
import { chartVendors } from "./chart-vendor.js";

// One namespace per build shares Plot/D3 across every chart import. The worker
// is discarded afterward, releasing both loader hooks and the ESM module cache.
const loader = register({ namespace: "chart-build" });

/** @param {string} chartPath */
async function loadChart(chartPath) {
  /** @type {{ default: any }} */
  const loaded = await loader.import(pathToFileURL(resolve(chartPath)).href, import.meta.url);
  const definition = loaded.default?.default ?? loaded.default;
  if (!definition || typeof definition.parseData !== "function" || !Array.isArray(definition.charts) || !definition.charts.length) {
    throw new Error(`${chartPath} must default-export a chart definition.`);
  }
  const data = definition.parseData(JSON.parse(await readFile(join(dirname(chartPath), "data.json"), "utf8")));
  return { definition, data };
}

/** Inline, accessible charts rendered with the page's fonts, not social-card fonts.
 * @param {string} inputPath
 * @param {"charts" | "tabs"} part
 */
/** @param {string} inputPath @param {"charts" | "tabs"} [part] @param {string} [chartId] */
export async function renderInitialCharts(inputPath, part = "charts", chartId) {
  const { definition, data } = await loadChart(join(dirname(inputPath), "chart.ts"));
  const chart = definition.charts.find(/** @param {any} item */ (item) => item.id === chartId) ?? definition.charts[0];
  const dom = new JSDOM("<!doctype html><html><body></body></html>");
  try {
    if (part === "tabs") {
      const tabs = dom.window.document.createElement("div");
      tabs.className = "chart-tabs";
      tabs.setAttribute("role", "tablist");
      tabs.setAttribute("aria-label", "Chart views");
      tabs.setAttribute("data-chart-tabs", "");
      tabs.hidden = definition.charts.length < 2;
      if (!tabs.hidden) {
        definition.charts.forEach(/** @param {any} item @param {number} index */ (item, index) => {
          const button = dom.window.document.createElement("button");
          button.type = "button";
          button.disabled = true;
          button.setAttribute("role", "tab");
          button.dataset.chartId = item.id;
          button.setAttribute("aria-selected", String(item.id === chart.id));
          button.textContent = item.label;
          tabs.append(button);
        });
      }
      return tabs.outerHTML;
    }
    return CHART_LAYOUTS.map((layout) => {
      const svg = chart.render(data, {
        document: dom.window.document, ...chartSize(layout.minWidth), mode: "static",
      });
      if (svg.namespaceURI !== "http://www.w3.org/2000/svg") throw new Error(`${inputPath} must render an SVG element.`);
      svg.setAttribute("role", "img");
      svg.setAttribute("aria-label", chart.alt);
      svg.setAttribute("focusable", "false");
      return `<div class="chart-static chart-static-${layout.name}">${svg.outerHTML}</div>`;
    }).join("\n");
  } finally {
    dom.window.close();
  }
}

/** @param {string} directory @returns {Promise<Array<[string, string]>>} */
async function findChartEntries(directory) {
  const entries = [];
  for (const item of await readdir(directory, { withFileTypes: true })) {
    if (item.isDirectory() && item.name === "tests") continue;
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
  // Remove shared chart assets left by builds before page-local output.
  await rm(resolve(siteOutputDirectory, "assets/charts"), { recursive: true, force: true });
  if (!entries.length) return;
  const vendorDirectory = resolve(siteOutputDirectory, "assets/vendor");
  await mkdir(vendorDirectory, { recursive: true });
  for (const vendor of chartVendors) {
    await copyFile(vendor.source, join(vendorDirectory, basename(vendor.url)));
    await copyFile(vendor.license, join(vendorDirectory, basename(vendor.licenseUrl)));
  }

  for (const [name, chartPath] of entries) {
    const { definition, data } = await loadChart(chartPath);
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

    // Match the year/nested-directory permalink used by pages.11tydata.js.
    const pageOutputDirectory = resolve(siteOutputDirectory, relative(resolve(pagesDirectory), dirname(resolve(chartPath))));
    const sourcePageDirectory = dirname(resolve(chartPath));
    await mkdir(pageOutputDirectory, { recursive: true });
    await writeFile(join(pageOutputDirectory, "chart.png"), png);

    // Each page is a separate build: no site-wide chunks or dependency graph.
    // Types and Node rendering still use the original npm imports.
    await build({
      stdin: {
        contents: `import definition from ${JSON.stringify(resolve(chartPath))};\nimport { mountChartPage } from ${JSON.stringify(resolve("src/charts/runtime.ts"))};\nmountChartPage(definition);\n`,
        resolveDir: process.cwd(),
        sourcefile: `${name}-entry.ts`,
        loader: "ts",
      },
      outfile: join(pageOutputDirectory, "chart.js"),
      bundle: true,
      format: "esm",
      platform: "browser",
      target: "es2020",
      alias: {
        "@observablehq/plot": resolve("src/charts/plot-browser.cjs"),
        d3: resolve("src/charts/d3-browser.cjs"),
      },
    });

    // Alternate views are static, self-contained entry URLs, generated from
    // the same page markup and assets. Refuse IDs that shadow authored pages.
    const baseHtmlPath = join(pageOutputDirectory, "index.html");
    const baseHtml = await readFile(baseHtmlPath, "utf8").catch((error) => {
      if (error?.code === "ENOENT") return undefined;
      throw error;
    });
    // buildChartBundles is also used independently for bundle-only fixture
    // builds; only full Eleventy output has page HTML to make share variants.
    if (!baseHtml) continue;
    for (const chart of definition.charts) {
      if (definition.charts.length < 2) continue;
      const authoredCollision = await readdir(sourcePageDirectory, { withFileTypes: true });
      if (authoredCollision.some((entry) =>
        (entry.isDirectory() && entry.name === chart.id) ||
        (entry.isFile() && [".md", ".html", ".njk"].some((extension) => entry.name === `${chart.id}${extension}`)))) {
        throw new Error(`${chartPath} view id "${chart.id}" collides with an authored source path.`);
      }
      const variantDirectory = join(pageOutputDirectory, chart.id);
      const variantHtmlPath = join(variantDirectory, "index.html");
      await mkdir(variantDirectory, { recursive: true });
      const variantDom = new JSDOM(baseHtml);
      try {
        const { document } = variantDom.window;
        const base = document.querySelector("base");
        if (base) base.setAttribute("href", "../");
        const root = document.querySelector("[data-chart-root]");
        if (!root) throw new Error(`${baseHtmlPath} is missing the chart root.`);
        root.innerHTML = await renderInitialCharts(join(sourcePageDirectory, "index.md"), "charts", chart.id);
        const tabs = document.querySelector("[data-chart-tabs]");
        for (const tab of tabs?.querySelectorAll("[data-chart-id]") ?? []) {
          const selected = tab.getAttribute("data-chart-id") === chart.id;
          tab.setAttribute("aria-selected", String(selected));
        }
        document.querySelector('meta[property="og:url"]')?.setAttribute("content", `https://pages.skybrian.com/${relative(resolve(siteOutputDirectory), variantHtmlPath).replace(/index\.html$/, "")}`);
        document.querySelector('meta[property="og:image:alt"]')?.setAttribute("content", chart.alt);
        const previewDom = new JSDOM("<!doctype html><html><body></body></html>");
        try {
          const svg = chart.render(data, { document: previewDom.window.document, width: 1200, height: 630, mode: "preview" });
          if (svg.namespaceURI !== "http://www.w3.org/2000/svg") throw new Error(`${chartPath} view "${chart.id}" must render an SVG element.`);
          svg.setAttribute("xmlns", "http://www.w3.org/2000/svg");
          if (!svg.hasAttribute("viewBox")) svg.setAttribute("viewBox", "0 0 1200 630");
          const image = await sharp(Buffer.from(svg.outerHTML)).flatten({ background: "#ffffff" }).resize(1200, 630, { fit: "contain", background: "#ffffff" }).png().toBuffer();
          const imageName = `${chart.id}-${createHash("sha256").update(image).digest("hex").slice(0, 12)}.png`;
          await writeFile(join(pageOutputDirectory, imageName), image);
          document.querySelector('meta[property="og:image"]')?.setAttribute("content", `https://pages.skybrian.com/${relative(resolve(siteOutputDirectory), join(pageOutputDirectory, imageName))}`);
        } finally {
          previewDom.window.close();
        }
        await writeFile(variantHtmlPath, `<!doctype html>\n${document.documentElement.outerHTML}`);
      } finally {
        variantDom.window.close();
      }
    }
  }
}

if (!parentPort) throw new Error("Chart renderer must run in a worker.");
const port = parentPort;
port.on("message", async ({ id, method, args }) => {
  try {
    const result = method === "render"
      ? await renderInitialCharts(args[0], args[1], args[2])
      : await buildChartBundles(args[0]);
    port.postMessage({ id, result });
  } catch (error) {
    port.postMessage({ id, error });
  }
});
