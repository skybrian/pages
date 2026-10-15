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

it("defaults Markdown to Rendered and exposes the editor and changes panels", () => {
  const html = renderSourceView({
    name: "guide.md",
    breadcrumbs: [],
    language: "markdown",
    source: "# Guide\n\nRead [another](other.md).",
    editable: true,
    sourceEncoded: Buffer.from("# Guide").toString("base64"),
  });
  const dom = new JSDOM(html);
  try {
    const { document } = dom.window;
    assert.equal(document.querySelector("#file-tab-rendered")?.getAttribute("aria-selected"), "true");
    assert.equal(document.querySelector("#file-panel-rendered")?.hasAttribute("hidden"), false);
    assert.equal(document.querySelector("#file-rendered-content h1")?.textContent, "Guide");
    assert.equal(document.querySelector("#file-rendered-content a")?.getAttribute("href"), "other.md");
    const styles = [...document.querySelectorAll("style")].map((style) => style.textContent).join("\n");
    assert.match(styles, /#file-rendered-content ul\{list-style:disc;padding-left:2em\}/);
    assert.match(styles, /#file-rendered-content ol\{list-style:decimal;padding-left:2em\}/);
    assert.match(styles, /#file-panel-source code/);
    assert.match(styles, /#file-rendered-content pre code/);
    assert.equal(document.querySelector("#file-panel-source")?.hasAttribute("hidden"), true);
    assert.ok(document.querySelector("#file-tab-editor"));
    assert.ok(document.querySelector("#file-tab-changes"));
    assert.equal(document.querySelector("#editor-status")?.getAttribute("role"), "status");
    assert.match(document.querySelector("#file-panel-editor")?.textContent ?? "", /Changes save automatically/);
    assert.equal(document.querySelector("#save-markdown"), null);
    assert.equal(document.querySelector("#cancel-markdown"), null);
    assert.equal(document.querySelector("#reload-markdown")?.hasAttribute("hidden"), true);
    assert.equal(document.querySelector("#file-changes-status")?.getAttribute("role"), "status");
    assert.equal(document.querySelector("#file-view-status")?.getAttribute("role"), "status");
    assert.ok(document.querySelector("#file-changes-diff"));
    assert.match(document.querySelector("#revert-to-head")?.textContent ?? "", /Revert to HEAD…/);
  } finally {
    dom.window.close();
  }
});

it("defaults non-Markdown files to Source without Markdown-only tabs", () => {
  const dom = new JSDOM(renderSourceView({
    name: "script.ts",
    breadcrumbs: [],
    language: "typescript",
    source: "const answer = 42;",
  }));
  try {
    const { document } = dom.window;
    assert.equal(document.querySelector("#file-tab-source")?.getAttribute("aria-selected"), "true");
    assert.equal(document.querySelector("#file-panel-source")?.hasAttribute("hidden"), false);
    assert.equal(document.querySelector("#file-source-code")?.textContent, "const answer = 42;");
    assert.equal(document.querySelector("#file-tab-rendered"), null);
    assert.equal(document.querySelector("#file-tab-changes"), null);
  } finally {
    dom.window.close();
  }
});

it("strips front matter only from rendered Markdown and preserves the exact source", () => {
  const source = "\uFEFF---\ntitle: Metadata\n---\n# Visible";
  const dom = new JSDOM(renderSourceView({
    name: "metadata.md",
    breadcrumbs: [],
    language: "markdown",
    source,
    editable: true,
  }));
  try {
    const { document } = dom.window;
    assert.equal(document.querySelector("#file-rendered-content h1")?.textContent, "Visible");
    assert.doesNotMatch(document.querySelector("#file-rendered-content")?.textContent ?? "", /Metadata/);
    assert.equal(document.querySelector("#file-source-code")?.textContent, source);
  } finally {
    dom.window.close();
  }
});
