import assert from "node:assert/strict";
import { it } from "node:test";
import { JSDOM } from "jsdom";
import { renderMarkdown } from "./markdown.ts";

it("renders Markdown while treating raw HTML as text", () => {
  const html = renderMarkdown("# Guide\n\n<script>alert(1)</script>\n\n**safe**");
  const dom = new JSDOM(`<main>${html}</main>`);
  try {
    const main = dom.window.document.querySelector("main")!;
    assert.equal(main.querySelector("h1")?.textContent, "Guide");
    assert.equal(main.querySelector("script"), null);
    assert.match(main.textContent ?? "", /<script>alert\(1\)<\/script>/);
    assert.equal(main.querySelector("strong")?.textContent, "safe");
  } finally {
    dom.window.close();
  }
});

it("rejects dangerous links but preserves file-browser-relative links and images", () => {
  const html = renderMarkdown("[bad](javascript:alert%281%29) [guide](../guide.md) ![diagram](images/diagram.png)");
  const dom = new JSDOM(`<main>${html}</main>`);
  try {
    const main = dom.window.document.querySelector("main")!;
    assert.equal(main.querySelector('a[href^="javascript:"]'), null);
    assert.equal(main.querySelector("a")?.getAttribute("href"), "../guide.md");
    assert.equal(main.querySelector("img")?.getAttribute("src"), "images/diagram.png");
  } finally {
    dom.window.close();
  }
});

it("omits a BOM-prefixed, delimiter-complete front matter block without parsing it", () => {
  const html = renderMarkdown("\uFEFF---\r\ntitle: Preview\nlayout: false\r\n---\r\n# Body");
  const dom = new JSDOM(`<main>${html}</main>`);
  try {
    const main = dom.window.document.querySelector("main")!;
    assert.equal(main.querySelector("h1")?.textContent, "Body");
    assert.doesNotMatch(main.textContent ?? "", /title: Preview|layout: false/);
  } finally {
    dom.window.close();
  }

  const unclosed = renderMarkdown("---\ntitle: still content\n# Not front matter");
  assert.match(unclosed, /title: still content/);
});

it("adds deterministic, safe heading fragment IDs including duplicate suffixes", () => {
  const html = renderMarkdown("# Markdown Editor\n\n## Référence & Links!\n\n## Référence & Links!\n\n## !!!");
  const dom = new JSDOM(`<main>${html}</main>`);
  try {
    const headings = [...dom.window.document.querySelectorAll("h1,h2")];
    assert.deepEqual(headings.map((heading) => heading.id), [
      "markdown-heading-markdown-editor",
      "markdown-heading-reference-links",
      "markdown-heading-reference-links-1",
      "markdown-heading-section",
    ]);
    assert.notEqual(headings[0]?.id, "markdown-editor");
  } finally {
    dom.window.close();
  }
});

it("namespaces fragment links and keeps adversarial duplicate slugs unique", () => {
  const dom = new JSDOM(`<main>${renderMarkdown(
    "[Jump](#foo)\n\n# Foo\n\n# Foo\n\n# Foo-1",
  )}</main>`);
  try {
    const { document } = dom.window;
    const headings = [...document.querySelectorAll("h1")];
    const ids = headings.map((heading) => heading.id);
    assert.deepEqual(ids, [
      "markdown-heading-foo",
      "markdown-heading-foo-1",
      "markdown-heading-foo-1-1",
    ]);
    assert.equal(new Set(ids).size, ids.length);
    assert.equal(document.querySelector("a")?.getAttribute("href"), "#markdown-heading-foo");
    assert.equal(document.querySelector("#markdown-editor"), null);
  } finally {
    dom.window.close();
  }
});

it("rewrites local Markdown document fragments but leaves unrelated links alone", () => {
  const dom = new JSDOM(`<main>${renderMarkdown([
    "[Same directory](guide.md#foo)",
    "[Parent directory](../guide.markdown#foo)",
    "[External](https://example.com/guide.md#foo)",
    "[Protocol relative](//example.com/guide.md#foo)",
    "[Image resource](diagram.png#foo)",
    "[JSON endpoint](guide.md?format=json#foo)",
  ].join("\n\n"))}</main>`);
  try {
    const hrefs = [...dom.window.document.querySelectorAll("a")].map((link) => link.getAttribute("href"));
    assert.deepEqual(hrefs, [
      "guide.md#markdown-heading-foo",
      "../guide.markdown#markdown-heading-foo",
      "https://example.com/guide.md#foo",
      "//example.com/guide.md#foo",
      "diagram.png#foo",
      "guide.md?format=json#foo",
    ]);
  } finally {
    dom.window.close();
  }
});
