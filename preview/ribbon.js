import path from "node:path";

export const PREVIEW_RIBBON_STYLES = `
.preview-ribbon {
  position: fixed; z-index: 10; top: 1.5rem; right: -3.2rem;
  width: 11rem; padding: .35rem 0; transform: rotate(45deg);
  background: #8b2525; color: #fff; text-align: center;
  font: 600 .875rem/1.4 system-ui, sans-serif; text-decoration: none;
  box-shadow: 0 2px 6px #0005;
}
.preview-ribbon:focus-visible { outline: 3px solid #ffda5c; outline-offset: 3px; }
@media (max-width: 480px) {
  .preview-ribbon { top: 1rem; right: -3.6rem; width: 10rem; font-size: .75rem; }
}
@media print { .preview-ribbon { display: none; } }
`.trim();

/**
 * Map an Eleventy input path to the source viewer route.
 * @param {string} inputPath
 */
export function previewSourceUrl(inputPath) {
  const normalized = inputPath.replaceAll("\\", "/").replace(/^\.\//, "");
  if (!normalized || normalized.startsWith("/") || normalized.split("/").some((part) => part === "..")) {
    throw new Error("Expected a source path relative to the repository root");
  }
  return `/admin/files/${normalized.split("/").map(encodeURIComponent).join("/")}`;
}

/** @param {string | undefined} runMode */
export function isPreviewRunMode(runMode) {
  return runMode === "serve";
}

/**
 * Keep preview URLs tied to Eleventy's latest successful page results. Entries
 * without a generated URL (including source assets and non-page files) are
 * deliberately excluded.
 * @param {string} rootDirectory
 */
export function createPreviewUrlLookup(rootDirectory) {
  const root = path.resolve(rootDirectory);
  /** @type {Map<string, string>} */
  const pageUrls = new Map();
  return {
    /** @param {Array<{inputPath?: string, url?: string | false}>} results */
    refresh(results) {
      pageUrls.clear();
      for (const result of results) {
        if (typeof result.inputPath !== "string" || typeof result.url !== "string" || !result.url.startsWith("/")) {
          continue;
        }
        const inputPath = path.resolve(root, result.inputPath);
        if (inputPath !== root && !inputPath.startsWith(`${root}${path.sep}`)) continue;
        pageUrls.set(inputPath, result.url);
      }
    },
    /** @param {string} sourcePath Relative to the repository root. */
    resolve(sourcePath) {
      return pageUrls.get(path.resolve(root, sourcePath));
    },
  };
}
