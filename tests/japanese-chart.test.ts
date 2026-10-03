import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { it } from "node:test";
import { runInNewContext } from "node:vm";

const html = await readFile("src/pages/2026/japanese-financial-assets-abroad.html", "utf8");
const svg = html.match(/<svg\b[\s\S]*?<\/svg>/)![0];
const script = html.match(/<script>([\s\S]*?)<\/script>/)![1];

it("retains a self-contained chart with a linked source and mobile viewport", () => {
  assert.ok(html.includes('name="viewport"'));
  assert.ok(html.includes('href="/"'));
  assert.ok(!html.includes("Skybridge"));
  assert.ok(svg.includes('xmlns="http://www.w3.org/2000/svg"'));
  assert.ok(svg.includes("<style>"));
  assert.ok(svg.includes('<a href="https://www.mof.go.jp/english/policy/international_policy/reference/iip/index.htm">'));
  assert.equal((svg.match(/class="area"/g) ?? []).length, 5);
  assert.ok(svg.includes("Total ¥1,805.6T"));
});

for (const mode of ["clipboard", "fallback", "blocked"] as const) {
  it(`copies only SVG using ${mode}`, async () => {
    let copied = "";
    let removed = false;
    let reset: (() => void) | undefined;
    const button = { textContent: "Copy SVG", addEventListener() {} };
    const status = { textContent: "" };
    const textarea = {
      value: "", style: {}, setAttribute() {}, select() {},
      remove() { removed = true; },
    };
    const context = {
      document: {
        getElementById(id: string) {
          return id === "chart" ? svg : id === "copy-svg" ? button : status;
        },
        createElement() { return textarea; },
        body: { appendChild() {} },
        execCommand() { copied = textarea.value; return mode !== "blocked"; },
      },
      navigator: { clipboard: { async writeText(value: string) {
        if (mode !== "clipboard") throw new Error("Denied");
        copied = value;
      } } },
      XMLSerializer: class { serializeToString(value: string) { return value; } },
      setTimeout(callback: () => void) { reset = callback; },
    };
    runInNewContext(script, context);
    const result = runInNewContext("copySvg()", context) as Promise<void>;
    if (mode === "blocked") {
      await assert.rejects(result, /Copy failed/);
      assert.ok(removed);
      return;
    }
    await result;
    assert.equal(copied, svg);
    assert.equal(status.textContent, "SVG copied.");
    assert.equal(button.textContent, "Copied");
    if (mode === "fallback") assert.ok(removed);
    reset!();
    assert.equal(button.textContent, "Copy SVG");
  });
}
