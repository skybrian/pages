import assert from "node:assert/strict";
import { it } from "node:test";
import { chartSize } from "../src/charts/sizing.js";

it("selects the same layout tiers as the static chart container queries", () => {
  for (const [available, width] of [[280, 320], [499, 320], [500, 560], [759, 560], [760, 896], [1000, 896]]) {
    assert.equal(chartSize(available!).width, width);
  }
});
