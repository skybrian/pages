import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { it } from "node:test";
import { JSDOM } from "jsdom";
import { getSiteTestOutput } from "../../../../../tests/helpers/site-build.ts";
import definition from "../chart.ts";

it("reserves the initial tabs for every income chart", async () => {
  const output = await getSiteTestOutput();
  const html = await readFile(
    path.join(output, "2026", "us-households-by-income-band", "index.html"), "utf8",
  );
  const homepage = await readFile(path.join(output, "index.html"), "utf8");
  const dom = new JSDOM(html);
  try {
    const document = dom.window.document;
    const description = document.querySelector('meta[name="description"]')?.getAttribute("content");
    assert.ok(description);
    assert.equal(document.querySelector('meta[property="og:description"]')?.getAttribute("content"), description);
    assert.ok(homepage.includes(description));
    assert.ok(!document.body.textContent?.includes(description));

    const tabs = document.querySelector<HTMLElement>("[data-chart-tabs]");
    assert.ok(tabs);
    assert.equal(tabs.hidden, false);
    const buttons = [...tabs.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
    assert.equal(buttons.length, definition.charts.length);
    assert.deepEqual(buttons.map((button) => button.textContent), definition.charts.map((chart) => chart.label));
    assert.equal(buttons.filter((button) => button.getAttribute("aria-selected") === "true").length, 1);
  } finally {
    dom.window.close();
  }
});
