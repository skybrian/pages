import { readdir, rm } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { build } from "esbuild";

const pagesDirectory = resolve("src/pages");
const outputDirectory = resolve("_site/assets/charts");

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

export async function buildChartBundles() {
  const entries = await findChartEntries(pagesDirectory);
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
}
