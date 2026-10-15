import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { it } from "node:test";
import { JSDOM } from "jsdom";
import { assertStaticChartParity } from "../../../../../tests/helpers/static-chart.ts";
import chart from "../chart.ts";

const data = JSON.parse(await readFile(
  new URL("../data.json", import.meta.url), "utf8",
)) as Array<Record<string, unknown>>;

it("preserves static chart geometry and labels when enhanced", async () => {
  await assertStaticChartParity(new URL("../", import.meta.url), chart);
});

it("preserves all reported milestones and labels", () => {
  assert.deepEqual(data.filter((row) => row.series === "runrate").map((row) => [row.date, row.value, row.label]), [
    ["2025-12-31", 9, "~$9B"], ["2026-02-12", 14, "$14B"],
    ["2026-02-28", 19, "~$19B"], ["2026-04-06", 30, ">$30B"],
    ["2026-05-10", 47, "~$47B"], ["2026-07-31", 65, ">$65B"],
  ]);
});

it("renders quarterly revenue separately from run-rate milestones at every size", () => {
  const quarterly = chart.charts.find((view) => view.id === "quarterly-revenue")!;
  assert.deepEqual(data.filter((row) => row.series === "quarterly").map((row) => [row.date, row.value]), [
    ["2026-03-31", 4.8], ["2026-06-30", 11.5], ["2026-09-30", 16.8],
  ]);
  for (const width of [350, 720, 1200]) {
    const document = new JSDOM("").window.document;
    const render = (mode: "static" | "interactive" | "preview") => quarterly.render(chart.parseData(data), {
      document, width, height: 196, mode,
    });
    const svg = render("static");
    assert.equal(svg.getAttribute("role"), "img");
    assert.equal(svg.getAttribute("aria-label"), quarterly.alt);
    assert.equal(svg.getAttribute("height"), "400");
    assert.equal(svg.querySelectorAll('g[aria-label="bar"] rect').length, 3);
    for (const text of ["Q1 2026", "Q2 2026", "Q3 2026", "~$4.8B", "$11.5B", "$16.8B"]) {
      assert.ok(svg.textContent?.includes(text));
    }
    assert.ok(!svg.textContent?.includes(">$65B"));
    const labels = (element: SVGSVGElement) => [...element.querySelectorAll("text")].map((text) => ({
      text: text.textContent, x: text.getAttribute("x"), y: text.getAttribute("y"),
      transform: text.getAttribute("transform"),
    }));
    assert.deepEqual(labels(svg), labels(render("interactive")));
    assert.equal(render("preview").getAttribute("height"), "196");
  }
  const document = new JSDOM("").window.document;
  const runrate = chart.charts[0].render(chart.parseData(data), {
    document, width: 720, height: 400, mode: "static",
  });
  assert.ok(!runrate.textContent?.includes("$16.8B"));
  assert.equal(runrate.querySelectorAll("circle").length, 6);
});

it("rejects invalid values, unknown measures, and missing series", () => {
  const fixture = (series: string, value = 1) => ({
    date: "2026-03-31", value, series, label: "$1B",
    dateText: "Test quarter", source: "Test source", url: "https://example.com",
  });
  assert.doesNotThrow(() => chart.parseData([fixture("runrate"), fixture("quarterly")]));
  assert.throws(() => chart.parseData([fixture("runrate")]), /Missing quarterly/);
  assert.throws(() => chart.parseData([fixture("quarterly")]), /Missing runrate/);
  for (const invalid of [fixture("annual"), fixture("quarterly", -1), fixture("quarterly", NaN)]) {
    assert.throws(() => chart.parseData([fixture("runrate"), invalid]), /Invalid point/);
  }
});

it("renders an accessible chart at the supplied preview dimensions", () => {
  const parsed = chart.parseData(data);
  const document = new JSDOM("").window.document;
  const svg = chart.charts[0].render(parsed, {
    document, width: 1000, height: 630, mode: "preview",
  });
  assert.equal(svg.getAttribute("height"), "630");
  assert.equal(svg.getAttribute("aria-label"), chart.charts[0].alt);
  assert.ok(svg.querySelectorAll("circle").length >= 6);
  assert.ok(svg.textContent?.includes("Annual run rate"));
});

it("keeps the interactive mobile chart tall and anchors endpoint labels inward", () => {
  const document = new JSDOM("").window.document;
  const svg = chart.charts[0].render(chart.parseData(data), {
    document, width: 350, height: 196, mode: "interactive",
  });
  assert.equal(svg.getAttribute("height"), "400");
  const labels = [...svg.querySelectorAll("text")];
  assert.equal(labels.find((label) => label.textContent === "~$9B")?.getAttribute("text-anchor"), "start");
  assert.equal(labels.find((label) => label.textContent === "$14B")?.getAttribute("text-anchor"), "end");
  assert.equal(labels.find((label) => label.textContent === "~$19B")?.getAttribute("text-anchor"), "start");
  assert.equal(labels.find((label) => label.textContent === ">$65B")?.getAttribute("text-anchor"), "end");
  assert.ok(!labels.some((label) => label.textContent === "Anthropic revenue"));
});
