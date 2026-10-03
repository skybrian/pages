import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { it } from "node:test";
import { runInNewContext } from "node:vm";

const html = await readFile("src/pages/2026/us-households-by-income-band.html", "utf8");
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(match => match[1]!);

it("preserves both charts, the 58 years of data, and a locally hosted D3", async () => {
  assert.equal((html.match(/data-copy-svg>/g) ?? []).length, 2);
  assert.equal((html.match(/<svg\b/g) ?? []).length, 2);
  assert.ok(html.includes('<div id="table"></div>'));
  assert.ok(!html.includes("cdn.jsdelivr.net"));
  assert.ok(html.includes("/assets/vendor/d3.v7.9.0.min.js"));
  // Render from data, not a saved DOM snapshot that D3 would append to.
  for (const svg of html.matchAll(/<svg\b[^>]*>([\s\S]*?)<\/svg>/g)) {
    assert.equal(svg[1], "");
  }
  const context = {};
  runInNewContext(await readFile("src/assets/vendor/d3.v7.9.0.min.js", "utf8"), context);
  runInNewContext(scripts[0]!.split("const tooltip =")[0]!, context);
  const data = JSON.parse(runInNewContext("JSON.stringify(data)", context)) as Array<{
    year: number; low: number; middle: number; high: number; total: number;
  }>;
  assert.equal(data.length, 58);
  assert.equal(data[0]!.year, 1967);
  assert.equal(data[0]!.total, 60.81);
  assert.equal(data[57]!.year, 2024);
  assert.equal(data[57]!.total, 134.8);
  assert.equal(data[57]!.high, 57.694);
  data.forEach((row, i) => assert.equal(row.year, 1967 + i));
});

for (const mode of ["clipboard", "fallback", "blocked"] as const) {
  it(`copies an individual chart using ${mode} and restores its button`, async () => {
    let copied = "";
    let removed = false;
    const status = { textContent: "" };
    const card = { querySelector() { return status; } };
    const button = { disabled: false, closest() { return card; } };
    const textarea = {
      value: "", style: {}, focus() {}, select() {},
      remove() { removed = true; },
    };
    const context = {
      document: {
        querySelectorAll() { return []; },
        createElement() { return textarea; },
        body: { append() {} },
        execCommand() { copied = textarea.value; return mode !== "blocked"; },
      },
      exportChartSvg(selected: unknown) {
        assert.equal(selected, card);
        return "<svg>selected chart</svg>";
      },
      navigator: { clipboard: { async writeText(text: string) {
        if (mode !== "clipboard") throw new Error("Denied");
        copied = text;
      } } },
      button,
    };
    runInNewContext(scripts[1]!.slice(scripts[1]!.indexOf("async function copyChartSvg")), context);
    await runInNewContext("copyChartSvg(button)", context);
    assert.equal(button.disabled, false);
    if (mode === "blocked") assert.ok(status.textContent.startsWith("Copy failed"));
    else {
      assert.equal(status.textContent, "SVG copied.");
      assert.equal(copied, "<svg>selected chart</svg>");
    }
    if (mode !== "clipboard") assert.ok(removed);
  });
}
