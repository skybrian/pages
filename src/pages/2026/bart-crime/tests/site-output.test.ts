import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { it } from "node:test";
import { JSDOM } from "jsdom";
import { getSiteTestOutput } from "../../../../../tests/helpers/site-build.ts";

it("publishes the historical series with accessible reporting-break markers", async () => {
  const output = await getSiteTestOutput();
  const html = await readFile(path.join(output, "2026/bart-crime/index.html"), "utf8");
  const published = JSON.parse(await readFile(path.join(output, "2026/bart-crime/data.json"), "utf8"));
  const source = JSON.parse(await readFile(new URL("../data.json", import.meta.url), "utf8"));
  assert.deepEqual(published, source);
  const dom = new JSDOM(html);
  try {
    const document = dom.window.document;
    const charts = [...document.querySelectorAll<SVGSVGElement>(".chart-static svg")];
    assert.equal(charts.length, 3);
    for (const svg of charts) {
      assert.equal(svg.querySelectorAll("circle").length, source.quarters.length);
      assert.equal(svg.querySelectorAll('[aria-label="line"] path').length, 3);
      assert.equal(svg.querySelectorAll('[aria-label="rule"][stroke-dasharray="4,4"]').length, 2);
      assert.match(svg.getAttribute("aria-label")!, /Dashed vertical lines and gaps/);
      assert.match(svg.getAttribute("aria-label")!, /July 2018 through June 2026/);
    }
    const tabs = document.querySelectorAll('[data-chart-tabs] [role="tab"]');
    assert.deepEqual([...tabs].map((tab) => tab.textContent), [
      "Crimes per 1M trips", "Crime counts", "Passenger trips",
    ]);
  } finally {
    dom.window.close();
  }
});
