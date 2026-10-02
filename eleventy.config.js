import { fileURLToPath } from "node:url";

/**
 * @typedef {{
 *   addPassthroughCopy: (source: string | Record<string, string>, options?: { mode: "html-relative" }) => void,
 *   addFilter: (name: string, callback: (date: Date) => string) => void,
 *   setServerOptions: (options: { middleware: Array<(req: import("node:http").IncomingMessage, res: import("node:http").ServerResponse, next: (error?: unknown) => void) => unknown> }) => void
 * }} SiteConfig
 */

/** @param {SiteConfig} eleventyConfig */
export default async function (eleventyConfig) {
  eleventyConfig.addPassthroughCopy({ "src/assets": "assets" });
  // Keep referenced post images alongside each page's generated HTML.
  eleventyConfig.addPassthroughCopy("src/pages/**/*.{png,jpg,jpeg,gif,webp,avif,svg}", {
    mode: "html-relative",
  });
  eleventyConfig.addFilter("isoDate", (date) => date.toISOString().slice(0, 10));

  if (process.env.ELEVENTY_RUN_MODE === "serve") {
    const [{ createFileBrowserMiddleware }, { createMicrolighterAssetsMiddleware }] = await Promise.all([
      import("./preview/files.ts"),
      import("./preview/microlighter-assets.ts"),
    ]);
    eleventyConfig.setServerOptions({
      middleware: [
        createMicrolighterAssetsMiddleware(fileURLToPath(new URL(".", import.meta.url))),
        createFileBrowserMiddleware(fileURLToPath(new URL(".", import.meta.url))),
      ],
    });
  }

  return {
    dir: { input: "src", output: "_site" },
    templateFormats: ["md", "njk", "html"],
    // Leave chart code and template-like text in Markdown/HTML untouched.
    markdownTemplateEngine: false,
    htmlTemplateEngine: false,
  };
}
