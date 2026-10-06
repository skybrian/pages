import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** Derive browser asset versions from the same packages used for types and SVGs.
 * @param {string} packageName
 * @param {string} name
 * @param {string} distribution
 */
function vendor(packageName, name, distribution) {
  const directory = dirname(dirname(fileURLToPath(import.meta.resolve(packageName))));
  const { version } = JSON.parse(readFileSync(join(directory, "package.json"), "utf8"));
  return {
    source: join(directory, "dist", distribution),
    url: `/assets/vendor/${name}.v${version}.min.js`,
    license: join(directory, "LICENSE"),
    licenseUrl: `/assets/vendor/${name}.LICENSE.txt`,
  };
}

// Order matters: Plot's UMD distribution requires the D3 global.
export const chartVendors = [
  vendor("d3", "d3", "d3.min.js"),
  vendor("@observablehq/plot", "plot", "plot.umd.min.js"),
];
