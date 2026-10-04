import assert from "node:assert/strict";
import { it } from "node:test";
import { JSDOM } from "jsdom";
import { renderSourceView } from "./views.tsx";

it("wraps source lines and long tokens without changing the source text", () => {
  const source = `  Indented paragraph ${"word ".repeat(100)}\n\nhttps://example.com/${"a".repeat(300)}\n`;
  const dom = new JSDOM(renderSourceView({
    name: "index.md",
    breadcrumbs: [],
    language: "markdown",
    source,
  }));
  try {
    const pre = dom.window.document.querySelector("pre")!;
    const code = pre.querySelector("code")!;
    const styles = dom.window.getComputedStyle(pre);
    assert.equal(styles.whiteSpace, "pre-wrap");
    assert.equal(styles.overflowWrap, "anywhere");
    assert.notEqual(styles.overflow, "auto");
    assert.equal(dom.window.getComputedStyle(code).whiteSpace, "pre-wrap");
    assert.equal(code.textContent, source);
  } finally {
    dom.window.close();
  }
});
