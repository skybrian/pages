import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { it } from "node:test";
import { JSDOM } from "jsdom";
import chart from "../src/pages/2026/japanese-financial-assets-abroad/chart.ts";

const data = JSON.parse(await readFile(
  "src/pages/2026/japanese-financial-assets-abroad/data.json", "utf8",
)) as Array<Record<string, number>>;
const markdown = await readFile("src/pages/2026/japanese-financial-assets-abroad/index.md", "utf8");

it("preserves the full-precision 1996–2025 dataset and source notes", () => {
  assert.equal(data.length, 30);
  assert.deepEqual(data.map((row) => row.year), Array.from({ length: 30 }, (_, i) => 1996 + i));
  assert.deepEqual(data[0], {
    year: 1996, "Portfolio investment": 111.165, "Direct investment": 30.571,
    "Other investment": 135.372, "Reserve assets": 25.242, "Financial derivatives": 0.461,
  });
  assert.deepEqual(data.at(-1), {
    year: 2025, "Portfolio investment": 768.653, "Direct investment": 384.535,
    "Other investment": 373.269, "Reserve assets": 213.672, "Financial derivatives": 65.504,
  });
  assert.match(markdown, /mof\.go\.jp\/english\/policy\/international_policy\/reference\/iip\/index\.htm/);
  assert.match(markdown, /revised May 26, 2026/);
  assert.match(markdown, /BPM5 to BPM6/);
  assert.match(markdown, /direct BPM6 compilation begins in 2014/);
});

it("renders the stacked categories, BPM6 marker, total, and legend in the supplied dimensions", () => {
  const parsed = chart.parseData(data);
  const document = new JSDOM("").window.document;
  const svg = chart.charts[0].render(parsed, {
    document, width: 1100, height: 630, mode: "preview",
  });
  assert.equal(svg.tagName.toLowerCase(), "svg");
  assert.equal(svg.getAttribute("height"), "630");
  assert.equal(svg.getAttribute("aria-label"), chart.charts[0].alt);
  assert.ok(svg.querySelectorAll("path").length >= 5, "expected rendered area paths");
  assert.equal([...svg.querySelectorAll("path")]
    .filter((path) => ["#2563eb", "#0891b2", "#d97706", "#7c3aed", "#64748b"].includes(path.getAttribute("fill") ?? ""))
    .length, 5, "each category should render as one continuous stacked-area path");
  assert.ok(svg.textContent?.includes("BPM6 from 2014"));
  assert.ok(svg.textContent?.includes("Total ¥1,805.6T"));
  for (const category of [
    "Portfolio investment", "Direct investment", "Other investment",
    "Reserve assets", "Financial derivatives",
  ]) assert.ok(svg.textContent?.includes(category), `missing ${category} legend`);
});

it("wraps the legend within narrow mobile and desktop-sized SVGs", () => {
  const document = new JSDOM("").window.document;
  for (const [width, height] of [[350, 196], [824, 461]] as const) {
    const renderedHeight = Math.max(height, 420);
    const svg = chart.charts[0].render(chart.parseData(data), {
      document, width, height, mode: "interactive",
    });
    assert.equal(svg.getAttribute("width"), String(width));
    assert.equal(svg.getAttribute("height"), String(Math.max(height, 420)),
      "interactive charts should enforce a readable minimum height");
    const swatches = [...svg.querySelectorAll("rect")];
    const labels = [...svg.querySelectorAll("text")].filter((node) =>
      ["Portfolio investment", "Direct investment", "Other investment", "Reserve assets", "Financial derivatives"]
        .includes(node.textContent ?? ""));
    const labelSet = new Set(labels);
    assert.equal(swatches.length, 5);
    assert.equal(labels.length, 5);
    assert.ok(labels.every((label) => label.getAttribute("text-anchor") === "start"));
    const rows = new Set(labels.map((label) => label.getAttribute("y")));
    if (width === 350) assert.ok(rows.size > 1, "mobile legend should wrap onto multiple rows");
    for (const node of [...swatches, ...labels]) {
      const x = Number(node.getAttribute("x"));
      const y = Number(node.getAttribute("y"));
      assert.ok(x >= 0 && x <= width, "legend item starts within SVG width");
      assert.ok(y > 0 && y <= renderedHeight, "legend item is within SVG height");
      if (labelSet.has(node as SVGTextElement)) {
        assert.ok(x + (node.textContent?.length ?? 0) * 7 <= width, "legend label fits within SVG width");
      }
    }
    assert.ok(![...svg.querySelectorAll("text")].some((label) => /^1,9\d\d$/.test(label.textContent ?? "")),
      "year tick labels should not use thousands separators");
  }
});
