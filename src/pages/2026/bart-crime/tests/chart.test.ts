import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { it } from "node:test";
import { JSDOM } from "jsdom";
import { assertStaticChartParity } from "../../../../../tests/helpers/static-chart.ts";
import chart, { totalCrimes } from "../chart.ts";

const raw = JSON.parse(await readFile(new URL("../data.json", import.meta.url), "utf8"));
const data = chart.parseData(raw);

it("preserves static chart geometry and labels when enhanced", async () => {
  await assertStaticChartParity(new URL("../", import.meta.url), chart);
});

it("reconciles eight fiscal years to independent monthly totals and preserves digitization flags", () => {
  assert.equal(data.quarters.length, 32);
  assert.equal(data.quarters[0]!.start, "2018-07-01");
  assert.equal(data.quarters.at(-1)!.start, "2026-04-01");
  assert.equal(data.quarters.filter((row) => row.countMethod === "digitized-bars").length, 7);
  for (const [index, row] of data.quarters.entries()) {
    const expected = new Date(Date.UTC(2018, 6 + index * 3, 1)).toISOString().slice(0, 10);
    assert.equal(row.start, expected, "every calendar quarter is present");
  }
  assert.deepEqual(data.quarters.slice(0, 8).map((row) => row.crimes.electronicTheft), [
    203, 214, 220, 262, 248, 238, 108, 33,
  ]);
  assert.deepEqual(data.quarters.slice(0, 8).map(totalCrimes), [322, 354, 354, 384, 353, 375, 215, 110]);
  assert.ok(data.quarters.slice(0, 4).every((row) => row.countMethod === "monthly-reconstruction"));
  assert.equal(data.metadata.sourceBreak, "2019-07-01");
  assert.equal(data.metadata.reportingBreak, "2025-01-01");
  // Printed FY26 Q4 counts: electronic robbery is already inside the 9 robberies.
  const latest = data.quarters.at(-1)!;
  assert.equal(totalCrimes(latest), 59);
  assert.equal(latest.trips, 16_030_982);
  assert.equal((totalCrimes(latest) / latest.trips * 1e6).toFixed(2), "3.68");
  for (const [fiscalYear, total] of [["FY19", 118_103_841], ["FY20", 83_679_649]] as const) {
    const quarters = data.quarters.filter((row) => row.quarter.startsWith(fiscalYear));
    assert.equal(quarters.length, 4);
    assert.equal(quarters.reduce((sum, row) => sum + row.trips, 0), total);
  }
  const wrongTotal = structuredClone(raw);
  wrongTotal.quarters[0].trips++;
  assert.throws(() => chart.parseData(wrongTotal), /reconcile/);
  const wrongQuarter = structuredClone(raw);
  wrongQuarter.quarters[0].quarter = "FY20 Q1";
  assert.throws(() => chart.parseData(wrongQuarter), /Fiscal quarter/);
  const wrongSource = structuredClone(raw);
  wrongSource.quarters[0].crimeSources = [{ url: "https://example.com/", section: "Crime totals" }];
  assert.throws(() => chart.parseData(wrongSource), /crime provenance/);
});

it("renders all views at mobile and export sizes, distinguishing source and reporting breaks", () => {
  const document = new JSDOM("").window.document;
  for (const view of chart.charts) {
    for (const width of [320, 896, 1200]) {
      const svg = view.render(data, { document, width, height: 630, mode: "static" });
      assert.equal(svg.getAttribute("role"), "img");
      assert.equal(svg.querySelectorAll("circle").length, 32);
      assert.match(svg.getAttribute("aria-label")!, /July 2018–June 2026/);
      if (width === 320) {
        const labels = [...svg.querySelectorAll("text")].map((text) => text.textContent);
        assert.ok(labels.includes("2018"), "mobile axis starts in the pre-pandemic period");
        assert.ok(labels.includes("2026"));
      }
      const lines = svg.querySelectorAll('[aria-label="line"] path');
      assert.equal(lines.length, view.id === "trips" ? 1 : 3);
      const breaks = svg.querySelectorAll('[aria-label="rule"][stroke-dasharray]');
      assert.equal(breaks.length, view.id === "trips" ? 0 : 2);
      if (view.id !== "trips") {
        for (const marker of breaks) {
          assert.equal(marker.getAttribute("stroke-dasharray"), "4,4");
          const line = marker.querySelector("line")!;
          assert.equal(line.getAttribute("x1"), line.getAttribute("x2"), "break marker is vertical");
        }
        assert.match(svg.getAttribute("aria-label")!, /Dashed vertical lines and gaps/);
        assert.ok(svg.textContent?.includes("Jul 2019: source change"));
      }
      assert.ok(svg.textContent?.includes(view.id === "trips" ? "not unique riders" : "NIBRS"));
      // Custom export labels must not inherit Plot's centered text anchor.
      assert.equal(svg.querySelector('text[y="20"]')?.getAttribute("text-anchor"), "start");
    }
  }
});
