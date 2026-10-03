import { access, readdir, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { tsImport } from "tsx/esm/api";

/** @param {string} directory
 * @returns {Promise<Array<[string, string]>>}
 */
async function findChartEntries(directory) {
  /** @type {Array<[string, string]>} */
  const entries = [];

  for (const item of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, item.name);
    if (item.isDirectory()) {
      entries.push(...(await findChartEntries(path)));
    } else if (item.isFile() && item.name === "chart.ts") {
      const name = basename(directory);
      /** @type {[string, string]} */
      const entry = [name, path];
      entries.push(entry);
    }
  }

  return entries;
}

/**
 * @param {{
 *   pagesDirectory?: string,
 *   siteOutputDirectory?: string,
 *   outputMode?: string,
 * }} options
 */
export async function buildChartBundles({
  pagesDirectory = resolve("src/pages"),
  siteOutputDirectory = "_site",
  outputMode = "fs",
} = {}) {
  if (outputMode !== "fs") return;

  const entries = await findChartEntries(pagesDirectory);
  const outputDirectory = resolve(siteOutputDirectory, "assets/charts");
  await rm(outputDirectory, { recursive: true, force: true });
  if (entries.length === 0) return;

  const names = entries.map(([name]) => name);
  if (new Set(names).size !== names.length) {
    throw new Error(`Chart page directory names must be unique: ${names.join(", ")}`);
  }

  await build({
    entryPoints: Object.fromEntries(
      entries.map(([name, path]) => [name, resolve(path)]),
    ),
    outdir: outputDirectory,
    entryNames: "[name]",
    chunkNames: "chunks/[name]-[hash]",
    bundle: true,
    splitting: true,
    format: "esm",
    platform: "browser",
    target: "es2020",
  });

  // Optional server-only preview entry points are never bundled for the browser.
  for (const [name, chartPath] of entries) {
    const previewPath = resolve(dirname(chartPath), "preview.ts");
    try {
      await access(previewPath);
    } catch (error) {
      if (/** @type {NodeJS.ErrnoException} */ (error).code === "ENOENT") continue;
      throw error;
    }
    /** @type {{ renderPreview: (dataPath: string) => Promise<Buffer> }} */
    const { renderPreview } = await tsImport(pathToFileURL(previewPath).href, import.meta.url);
    const png = await renderPreview(resolve(dirname(chartPath), "data.json"));
    await writeFile(join(outputDirectory, `${name}.png`), png);
  }
}
