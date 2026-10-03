import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { defineChartPage } from "../src/charts/definition.ts";

const chart = {
  id: "main",
  label: "Main chart",
  alt: "A chart",
  render: () => ({} as SVGSVGElement),
};

describe("defineChartPage", () => {
  it("returns valid definitions and permits choosing a preview chart", () => {
    const definition = defineChartPage({
      parseData: (value: unknown) => value,
      charts: [chart],
      previewChart: "main",
    });
    assert.equal(definition.charts[0]?.id, "main");
  });

  it("rejects missing charts, incomplete metadata, duplicate ids, and unknown previews", () => {
    const parseData = (value: unknown) => value;
    assert.throws(() => defineChartPage({ parseData, charts: [] }), /at least one chart/);
    assert.throws(() => defineChartPage({ parseData, charts: [{ ...chart, alt: "" }] }), /unique id, label, alt text/);
    assert.throws(() => defineChartPage({ parseData, charts: [chart, chart] }), /unique id/);
    assert.throws(() => defineChartPage({ parseData, charts: [chart], previewChart: "other" }), /Unknown previewChart/);
  });
});
