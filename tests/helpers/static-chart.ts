import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { after } from "node:test";
import { JSDOM } from "jsdom";
import { fileURLToPath } from "node:url";
import { finishChartBuild, renderInitialCharts } from "../../scripts/build-charts.js";
import { CHART_LAYOUTS, chartSize } from "../../src/charts/sizing.js";
import type { ChartDefinition } from "../../src/charts/definition.ts";

/**
 * Compare every statically rendered layout with the corresponding interactive
 * chart so its dimensions, typography, and labels remain stable on enhancement.
 */
export async function assertStaticChartParity<Data>(
  pageDirectory: URL,
  definition: ChartDefinition<Data>,
): Promise<void> {
  const pagePath = fileURLToPath(pageDirectory);
  const data = definition.parseData(JSON.parse(await readFile(new URL("data.json", pageDirectory), "utf8")));
  const html = await renderInitialCharts(fileURLToPath(new URL("index.md", pageDirectory)));
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
      assert.deepEqual(labels(initial), labels(enhanced), `${pagePath}: ${layout.name} labels must not jump`);
    }
  } finally {
    dom.window.close();
  }
}

// The chart renderer is a shared worker; terminate it even when a parity
// assertion fails, without ending it between helper calls in this test file.
after(async () => {
  await finishChartBuild();
});
