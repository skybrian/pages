import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { it } from "node:test";
import { JSDOM } from "jsdom";
import { assertStaticChartParity } from "../../../../../tests/helpers/static-chart.ts";
import definition from "../chart.ts";

const dataBytes = await readFile(new URL("../data.json", import.meta.url));
const rows = definition.parseData(JSON.parse(dataBytes.toString("utf8")));

it("preserves static chart geometry and labels when enhanced", async () => {
  await assertStaticChartParity(new URL("../", import.meta.url), definition);
});

it("preserves the complete original 1967–2024 dataset", () => {
  assert.equal(rows.length, 58);
  assert.deepEqual(rows.map((row) => row.year), Array.from({ length: 58 }, (_, i) => 1967 + i));
  assert.deepEqual(rows[0], {
    year: 1967, low: 18.669, middle: 32.898, high: 9.243, total: 60.81, median_income: 54880,
  });
  assert.deepEqual(rows[37], {
    year: 2004, low: 28.664, middle: 46.113, high: 38.523, total: 113.3, median_income: 74260,
  });
  assert.deepEqual(rows.at(-1), {
    year: 2024, low: 27.364, middle: 49.876, high: 57.694, total: 134.8, median_income: 83730,
  });
  // Covers every value, including rounded totals and median incomes.
  assert.equal(createHash("sha256").update(dataBytes).digest("hex"),
    "3afb59b4175da5adf643cd33853d271f5d23fb4a8a3677384dc8cdebdfedce37");
});

it("rejects empty input and nonpositive denominators", () => {
  assert.throws(() => definition.parseData([]), /non-empty/);
  assert.throws(() => definition.parseData([{ ...rows[0], total: 0 }]), /positive/);
});

for (const chart of definition.charts) {
  it(`anchors ${chart.id} tooltips at each band's stacked upper edge`, () => {
    const dom = new JSDOM("");
    try {
      const { document, MouseEvent } = dom.window;
      // JSDOM has no SVG text layout; tooltip placement is reviewed in-browser.
      Object.defineProperty(dom.window.SVGElement.prototype, "getBBox", {
        value: () => ({ x: 0, y: 0, width: 100, height: 30 }),
      });
      const fixture = definition.parseData([
        { year: 2000, low: 20, middle: 30, high: 50, total: 100, median_income: 50000 },
        { year: 2001, low: 10, middle: 20, high: 20, total: 50, median_income: 50000 },
      ]);
      for (const width of [360, 940]) {
        const svg = chart.render(fixture, { document, width, height: 526, mode: "interactive" });
        document.body.append(svg);
        const compact = width < 600;
        const left = compact ? 48 : 76;
        const right = compact ? 24 : 70;
        const domainMax = chart.id === "shares" ? 100 : 142;
        const y = (value: number) => 526 - 44 - value / domainMax * (526 - 44 - 30);
        for (const row of fixture) {
          const x = left + (row.year - 1967) / (2024 - 1967) * (width - left - right);
          let cumulative = 0;
          for (const [key, band] of [["low", "Low-income"], ["middle", "Middle-income"], ["high", "High-income"]] as const) {
            const value = chart.id === "shares" ? row[key] / row.total * 100 : row[key];
            cumulative += value;
            svg.dispatchEvent(new MouseEvent("pointermove", { clientX: x, clientY: y(cumulative) }));
            const dot = svg.querySelector('g[aria-label="dot"] circle');
            assert.ok(dot, `${band} tooltip anchor is selected`);
            assert.ok(Math.abs(Number(dot.getAttribute("cx")) - x) < 1e-6);
            assert.ok(Math.abs(Number(dot.getAttribute("cy")) - y(cumulative)) < 1e-6,
              `${band} anchor uses the cumulative value, not the band's own value`);
            const tooltipText = [...svg.querySelectorAll('g[aria-label="tip"] text tspan')]
              .map((line) => line.textContent?.replaceAll("\u200b", "")).join("\n");
            assert.equal(tooltipText,
              `${row.year}\n${band}: ${value.toFixed(1)}${chart.id === "shares" ? "%" : "M households"}`);
          }
        }
        svg.remove();
      }
    } finally {
      dom.window.close();
    }
  });

  it(`renders the ${chart.id} chart at desktop and mobile widths`, () => {
    const document = new JSDOM("").window.document;
    const desktop = chart.render(rows, { document, width: 940, height: 526, mode: "preview" });
    const mobile = chart.render(rows, { document, width: 360, height: 202, mode: "interactive" });
    for (const svg of [desktop, mobile]) {
      assert.equal(svg.tagName.toLowerCase(), "svg");
      assert.ok(svg.querySelectorAll("path").length >= 3);
      assert.ok(svg.getAttribute("aria-label"));
      assert.ok(svg.querySelector('[aria-label="x-axis tick"]'));
      assert.ok(svg.querySelector('[aria-label="y-axis tick"]'));
    }
    assert.equal(
      [...desktop.querySelectorAll("path")].filter((path) => path.getAttribute("fill") && path.getAttribute("fill") !== "none").length,
      3,
      "one area path per income band; preview must not segment paths by tooltip text",
    );
    assert.equal(desktop.style.fontSize, "16px", "preview SVG uses readable text sizing");
    assert.equal(Number(desktop.getAttribute("height")), 526);
    assert.equal(Number(mobile.getAttribute("height")), 400, "mobile gets sufficient space for axes and plot");
    assert.ok(desktop.textContent?.includes(chart.id === "counts" ? "2024: 134.8M total" : "2024: 100%"),
      "final-year annotation remains visible");
    for (const [width, mode] of [[320, "static"], [560, "static"], [896, "static"], [940, "preview"], [360, "interactive"]] as const) {
      const svg = chart.render(rows, { document, width, height: 526, mode });
      const labels = svg.querySelectorAll('g[aria-label="text"] text');
      for (const [band, range] of [
        ["Low-income", "Under $35,000"],
        ["Middle-income", "$35,000–$99,999"],
        ["High-income", "$100,000 or more"],
      ]) {
        const label = [...labels].find((text) => text.textContent?.includes(band));
        assert.ok(label, `${band} is directly labeled at width ${width} in ${mode} mode`);
        assert.deepEqual([...label.querySelectorAll("tspan")].map((line) => line.textContent), [band, range]);
      }
      assert.equal(svg.querySelector('[aria-label="Income bands"]'), null, "ranges are in the areas, not a separate legend");
    }
    const no2004 = chart.render(rows.filter((row) => row.year !== 2004), {
      document, width: 940, height: 526, mode: "preview",
    });
    assert.ok(no2004.querySelectorAll("path").length >= 3, "annotation placement does not depend on 2004");
  });
}
