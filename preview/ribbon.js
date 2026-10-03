/**
 * Map an Eleventy input path to the existing read-only source viewer route.
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
