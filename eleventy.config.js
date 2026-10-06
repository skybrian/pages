import { fileURLToPath } from "node:url";
import { buildChartBundles, finishChartBuild, renderInitialCharts } from "./scripts/build-charts.js";
import { chartVendors } from "./scripts/chart-vendor.js";

/**
 * @typedef {{
 *   addPassthroughCopy: (source: string | Record<string, string>, options?: { mode: "html-relative" }) => void,
 *   addFilter: (name: string, callback: (...values: any[]) => string | Promise<string>) => void,
 *   addGlobalData: (name: string, value: unknown) => void,
 *   addWatchTarget: (target: string) => void,
 *   on: (event: string, callback: (eventArgs: {
 *     directories: { output: string },
 *     outputMode: string,
 *     results?: Array<{ inputPath?: string, url?: string | false }>,
 *   }) => Promise<void>) => void,
 *   setServerOptions: (options: { middleware: Array<(req: import("node:http").IncomingMessage, res: import("node:http").ServerResponse, next: (error?: unknown) => void) => unknown> }) => void
 * }} SiteConfig
 */

/** @param {SiteConfig} eleventyConfig */
export default async function (eleventyConfig) {
  const { createPreviewUrlLookup, isPreviewRunMode, PREVIEW_RIBBON_STYLES, previewSourceUrl } =
    await import("./preview/ribbon.js");
  const previewMode = isPreviewRunMode(process.env.ELEVENTY_RUN_MODE);
  eleventyConfig.addGlobalData("previewMode", previewMode);
  eleventyConfig.addGlobalData("chartVendors", chartVendors);
  eleventyConfig.addGlobalData("previewRibbonStyles", PREVIEW_RIBBON_STYLES);
  eleventyConfig.addFilter("previewSourceUrl", previewSourceUrl);
  eleventyConfig.addFilter("initialCharts", renderInitialCharts);
  const previewUrls = createPreviewUrlLookup(fileURLToPath(new URL(".", import.meta.url)));

  // Overlapping narrow Chokidar globs can omit Markdown from watched entries.
  // Watch the source tree together, including chart TS and data files.
  eleventyConfig.addWatchTarget("src");
  eleventyConfig.addWatchTarget("scripts/build-charts.js");
  eleventyConfig.addWatchTarget("scripts/build-charts-worker.js");
  eleventyConfig.addWatchTarget("scripts/chart-vendor.js");
  eleventyConfig.addWatchTarget("src/charts");
  // Also reset after an aborted build, which may not reach eleventy.after.
  eleventyConfig.on("eleventy.before", finishChartBuild);
  eleventyConfig.on("eleventy.after", ({ directories, outputMode, results }) => {
    previewUrls.refresh(results ?? []);
    return buildChartBundles({ siteOutputDirectory: directories.output, outputMode });
  });

  eleventyConfig.addPassthroughCopy({ "src/assets": "assets" });
  eleventyConfig.addPassthroughCopy({ "src/_redirects": "_redirects" });
  // Keep referenced post images alongside each page's generated HTML.
  eleventyConfig.addPassthroughCopy("src/pages/**/*.{png,jpg,jpeg,gif,webp,avif,svg}", {
    mode: "html-relative",
  });
  eleventyConfig.addPassthroughCopy("src/pages/**/data.json", { mode: "html-relative" });
  eleventyConfig.addFilter("isoDate", (date) => date.toISOString().slice(0, 10));

  if (process.env.ELEVENTY_RUN_MODE === "serve") {
    const [{ tsImport }, { createMicrolighterAssetsMiddleware }, { createEditorAssetsMiddleware }] = await Promise.all([
      import("tsx/esm/api"),
      import("./preview/microlighter-assets.ts"),
      import("./preview/editor-assets.ts"),
    ]);
    /** @type {Promise<{ createFileBrowserMiddleware: typeof import("./preview/files.ts").createFileBrowserMiddleware }>} */
    const fileBrowserModule = tsImport("./preview/files.ts", { parentURL: import.meta.url });
    const { createFileBrowserMiddleware } = await fileBrowserModule;
    eleventyConfig.setServerOptions({
      middleware: [
        createEditorAssetsMiddleware(),
        createMicrolighterAssetsMiddleware(fileURLToPath(new URL(".", import.meta.url))),
        createFileBrowserMiddleware(fileURLToPath(new URL(".", import.meta.url)), previewUrls.resolve),
      ],
    });
  }

  return {
    // Production builds must not overwrite files being served by the preview.
    dir: { input: "src", output: previewMode ? "_preview" : "_site" },
    templateFormats: ["md", "njk", "html"],
    // Leave chart code and template-like text in Markdown/HTML untouched.
    markdownTemplateEngine: false,
    htmlTemplateEngine: false,
  };
}
