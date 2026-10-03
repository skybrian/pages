import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { it } from "node:test";
import { JSDOM } from "jsdom";
import chart from "../src/pages/2026/anthropic-run-rates/chart.ts";

const data = JSON.parse(await readFile(
  "src/pages/2026/anthropic-run-rates/data.json", "utf8",
)) as Array<Record<string, unknown>>;
const markdown = await readFile("src/pages/2026/anthropic-run-rates/index.md", "utf8");

it("preserves all reported milestones, labels, sources, and the May date caveat", () => {
  assert.deepEqual(data.map((row) => [row.date, row.value, row.label]), [
    ["2025-12-31", 9, "~$9B"], ["2026-02-12", 14, "$14B"],
    ["2026-02-28", 19, "~$19B"], ["2026-04-06", 30, ">$30B"],
    ["2026-05-10", 47, "~$47B"], ["2026-07-31", 65, ">$65B"],
  ]);
  for (const url of [
    "anthropic.com/news/google-broadcom-partnership-compute",
    "anthropic.com/news/anthropic-raises-30-billion-series-g-funding-380-billion-post-money-valuation",
    "reuters.com/commentary/breakingviews/anthropic-gives-lesson-ai-revenue-hallucination-2026-03-10/",
    "anthropic.com/news/series-h",
    "reuters.com/technology/anthropic-revenue-run-rate-tops-65-billion-source-says-2026-08-17/",
  ]) assert.ok(markdown.includes(url), `missing source ${url}`);
  assert.match(markdown, /plotted at May 10/);
  assert.match(markdown, /earlier this month/);
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
