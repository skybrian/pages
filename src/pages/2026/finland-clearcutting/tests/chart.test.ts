import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { it } from "node:test";
import { JSDOM } from "jsdom";
import { assertStaticChartParity } from "../../../../../tests/helpers/static-chart.ts";
import chart, { squareKilometres } from "../chart.ts";

const raw = JSON.parse(await readFile(new URL("../data.json", import.meta.url), "utf8"));

it("converts hectares to square kilometres without rounding the source data", () => {
  assert.equal(squareKilometres(100), 1);
  assert.equal(squareKilometres(120841), 1208.41);
  assert.equal(squareKilometres(0), 0);
});

it("validates annual areas, ordering, and missing years", () => {
  assert.equal(chart.parseData(raw).annual.length, raw.annual.length);
  for (const value of [null, [], {}, { annual: [] }, { annual: [null] }]) {
    assert.throws(() => chart.parseData(value), TypeError);
  }
  const fixture = { annual: [{ year: 2020, hectares: 100 }, { year: 2021, hectares: 200 }] };
  for (const hectares of [-1, 1.5, "100", NaN, Infinity]) {
    assert.throws(() => chart.parseData({ annual: [{ year: 2020, hectares }] }), TypeError);
  }
  for (const year of [2019, 2020, 2022, "2021", NaN, 2021.5]) {
    assert.throws(() => chart.parseData({ annual: [fixture.annual[0], { year, hectares: 200 }] }), TypeError);
  }
  assert.equal(chart.parseData({ annual: [{ year: 2020, hectares: 0 }] }).annual[0]!.hectares, 0);
});

it("renders metric annual bars with accessible caveats but no redundant visible labels", () => {
  const dom = new JSDOM("");
  try {
    const data = chart.parseData(raw);
    for (const width of [320, 560, 896, 1200]) {
      for (const mode of ["static", "interactive", "preview"] as const) {
        const svg = chart.charts[0]!.render(data, {
          document: dom.window.document, width, height: 630, mode,
        });
        assert.equal(svg.getAttribute("role"), "img");
        assert.match(svg.getAttribute("aria-label")!, /square kilometres/);
        assert.match(svg.getAttribute("aria-label")!, /Notifications, not completed fellings/);
        assert.match(svg.textContent!, /km²/);
        const headings = [...svg.querySelectorAll(":scope > text")].slice(0, -1);
        assert.equal(headings.map(label => label.textContent).join(" "),
          "Total area of felling notifications to Finnish Forest Centre (km²)");
        assert.equal(headings.length, width < 896 ? 2 : 1);
        assert.doesNotMatch(svg.textContent!, /Notifications, not completed fellings/);
        assert.doesNotMatch(svg.textContent!, /Finland ·/);
        assert.doesNotMatch(svg.textContent!, /\de\+/);
        for (const label of svg.querySelectorAll(":scope > text")) {
          assert.equal(label.getAttribute("text-anchor"), "start");
          assert.notEqual(label.textContent, "Finland");
        }
        assert.equal(svg.querySelectorAll('g[aria-label="bar"] rect').length, data.annual.length);
      }
    }
  } finally {
    dom.window.close();
  }
});

it("keeps static and enhanced chart geometry and labels consistent", async () => {
  await assertStaticChartParity(new URL("../", import.meta.url), chart);
});
