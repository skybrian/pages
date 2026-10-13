import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { it } from "node:test";
import { JSDOM } from "jsdom";
import chart, { totalCrimes } from "../src/pages/2026/bart-crime/chart.ts";

const raw = JSON.parse(await readFile("src/pages/2026/bart-crime/data.json", "utf8"));
const data = chart.parseData(raw);

it("reconciles six fiscal years to independent monthly totals and preserves digitization flags", () => {
  assert.equal(data.quarters.length, 24);
  assert.equal(data.quarters[0]!.start, "2020-07-01");
  assert.equal(data.quarters.at(-1)!.start, "2026-04-01");
  assert.equal(data.quarters.filter((row) => row.countMethod === "digitized-bars").length, 7);
  // Printed FY26 Q4 counts: electronic robbery is already inside the 9 robberies.
  const latest = data.quarters.at(-1)!;
  assert.equal(totalCrimes(latest), 59);
  assert.equal(latest.trips, 16_030_982);
  assert.equal((totalCrimes(latest) / latest.trips * 1e6).toFixed(2), "3.68");
  const wrongTotal = structuredClone(raw);
  wrongTotal.quarters[0].trips++;
  assert.throws(() => chart.parseData(wrongTotal), /reconcile/);
  const wrongQuarter = structuredClone(raw);
  wrongQuarter.quarters[0].quarter = "FY20 Q1";
  assert.throws(() => chart.parseData(wrongQuarter), /Fiscal quarter/);
});

it("renders all views at mobile and export sizes, breaking crime lines at NIBRS", () => {
  const document = new JSDOM("").window.document;
  for (const view of chart.charts) {
    for (const width of [320, 896, 1200]) {
      const svg = view.render(data, { document, width, height: 630, mode: "static" });
      assert.equal(svg.getAttribute("role"), "img");
      assert.equal(svg.querySelectorAll("circle").length, 24);
      const lines = svg.querySelectorAll('[aria-label="line"] path');
      assert.equal(lines.length, view.id === "trips" ? 1 : 2);
      assert.ok(svg.textContent?.includes(view.id === "trips" ? "not unique riders" : "NIBRS"));
      // Custom export labels must not inherit Plot's centered text anchor.
      assert.equal(svg.querySelector('text[y="20"]')?.getAttribute("text-anchor"), "start");
    }
  }
});
