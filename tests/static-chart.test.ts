import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { it } from "node:test";
import { JSDOM } from "jsdom";
import { renderInitialCharts } from "../scripts/build-charts.js";
import { CHART_LAYOUTS, chartSize } from "../src/charts/sizing.js";
import type { ChartDefinition } from "../src/charts/definition.ts";
import kernel from "../src/pages/2026/kernel-cve-fixes/chart.ts";
import anthropic from "../src/pages/2026/anthropic-run-rates/chart.ts";
import japanese from "../src/pages/2026/japanese-financial-assets-abroad/chart.ts";
import income from "../src/pages/2026/us-households-by-income-band/chart.ts";

it("selects the same layout tiers as the static chart container queries", () => {
  for (const [available, width] of [[280, 320], [499, 320], [500, 560], [759, 560], [760, 896], [1000, 896]]) {
    assert.equal(chartSize(available!).width, width);
  }
});

async function checkChart<Data>(slug: string, definition: ChartDefinition<Data>) {
  const directory = `src/pages/2026/${slug}`;
  const data = definition.parseData(JSON.parse(await readFile(`${directory}/data.json`, "utf8")));
  const html = await renderInitialCharts(`${directory}/index.md`);
  const dom = new JSDOM(html);
  try {
    assert.equal(dom.window.document.querySelector("img"), null);
    for (const layout of CHART_LAYOUTS) {
      const initial = dom.window.document.querySelector<SVGSVGElement>(`.chart-static-${layout.name} svg`)!;
      const enhanced = definition.charts[0]!.render(data, {
        document: dom.window.document, ...chartSize(layout.minWidth), mode: "interactive",
      });
      assert.equal(initial.getAttribute("width"), enhanced.getAttribute("width"));
      assert.equal(initial.getAttribute("height"), enhanced.getAttribute("height"));
      assert.equal(initial.style.font, enhanced.style.font);
      assert.equal(initial.style.fontSize, enhanced.style.fontSize);
      const labels = (svg: SVGSVGElement) => [...svg.querySelectorAll("text")].map(text => ({
        text: text.textContent,
        fontSize: text.getAttribute("font-size"),
        x: text.getAttribute("x"),
        y: text.getAttribute("y"),
        transform: text.getAttribute("transform"),
      }));
      assert.deepEqual(labels(initial), labels(enhanced), `${slug}: ${layout.name} labels must not jump`);
    }
  } finally {
    dom.window.close();
  }
}

it("pre-renders every chart with the interactive dimensions, fonts, and labels", async () => {
  await checkChart("kernel-cve-fixes", kernel);
  await checkChart("anthropic-run-rates", anthropic);
  await checkChart("japanese-financial-assets-abroad", japanese);
  await checkChart("us-households-by-income-band", income);
});
