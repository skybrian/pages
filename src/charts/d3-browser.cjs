const browser = /** @type {Window & { d3?: typeof import("d3") }} */ (window);
if (!browser.d3) throw new Error("Load the D3 vendor script before the chart.");
module.exports = browser.d3;
