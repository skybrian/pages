import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { it } from "node:test";
import { JSDOM } from "jsdom";
import { assertStaticChartParity } from "../../../../../tests/helpers/static-chart.ts";
import chart from "../chart.ts";

const raw = JSON.parse(await readFile(new URL("../data.json", import.meta.url), "utf8"));

it("preserves fleet chart geometry and labels when enhanced", async () => {
  await assertStaticChartParity(new URL("../", import.meta.url), chart);
});

it("validates fleet observations and rejects invalid counts or ordering", () => {
  assert.equal(chart.parseData(raw).fleet.length, raw.fleet.length);
  for (const value of [null, [], {}, { fleet: [] }]) {
    assert.throws(() => chart.parseData(value), TypeError);
  }
  for (const vehicles of [0, -1, 1.5, "700", NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    const invalid = structuredClone(raw);
    invalid.fleet[0].vehicles = vehicles;
    assert.throws(() => chart.parseData(invalid), TypeError);
  }
  for (const patch of [
    { date: "not a date" },
    { qualifier: "exactly" },
    { source: "" },
    { url: "http://example.com/" },
  ]) {
    const invalid = structuredClone(raw);
    Object.assign(invalid.fleet[0], patch);
    assert.throws(() => chart.parseData(invalid), TypeError);
  }
  const duplicate = structuredClone(raw);
  duplicate.fleet[1].date = duplicate.fleet[0].date;
  assert.throws(() => chart.parseData(duplicate), TypeError);
  assert.throws(() => chart.parseData({ fleet: [...raw.fleet].reverse() }), TypeError);
});

it("renders accessible fleet charts with endpoint labels inside mobile and export bounds", () => {
  const dom = new JSDOM("");
  try {
    const data = chart.parseData(raw);
    for (const width of [320, 560, 896, 1200]) {
      for (const mode of ["static", "interactive", "preview"] as const) {
        const svg = chart.charts[0]!.render(data, {
          document: dom.window.document, width, height: 630, mode,
        });
        assert.equal(svg.getAttribute("role"), "img");
        assert.ok(svg.getAttribute("aria-label"));
        assert.equal(svg.querySelectorAll("circle").length, data.fleet.length);
        const labels = [...svg.querySelectorAll("text")].filter((text) => /^[~>]/.test(text.textContent ?? ""));
        assert.equal(labels.length, data.fleet.length);
        assert.equal(labels[0]!.closest("[text-anchor]")?.getAttribute("text-anchor"), "start");
        assert.equal(labels.at(-1)!.closest("[text-anchor]")?.getAttribute("text-anchor"), "end");
      }
    }
  } finally {
    dom.window.close();
  }
});
