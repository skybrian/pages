// Only esbuild's browser alias uses this adapter. Node and TypeScript resolve
// chart imports to the real package, preserving rendering and its full types.
const browser = /** @type {Window & { Plot?: typeof import("@observablehq/plot") }} */ (window);
if (!browser.Plot) throw new Error("Load the Plot vendor script before the chart.");
module.exports = browser.Plot;
