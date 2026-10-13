import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { it } from "node:test";
import { JSDOM } from "jsdom";
import { getSiteTestOutput } from "../../../../../tests/helpers/site-build.ts";

it("retains Japanese chart metadata and the BPM methodology in page notes", async () => {
  const output = await getSiteTestOutput();
  const slug = "japanese-financial-assets-abroad";
  const html = await readFile(path.join(output, "2026", slug, "index.html"), "utf8");
  const homepage = await readFile(path.join(output, "index.html"), "utf8");
  const dom = new JSDOM(html);
  try {
    const document = dom.window.document;
    const description = document.querySelector('meta[name="description"]')?.getAttribute("content");
    assert.ok(description);
    assert.equal(document.querySelector('meta[property="og:description"]')?.getAttribute("content"), description);
    assert.ok(homepage.includes(description));
    assert.ok(!document.body.textContent?.includes(description));

    const notes = document.querySelector(".chart-notes");
    assert.ok(notes?.textContent?.includes("BPM5 to BPM6"));
    assert.ok(notes?.textContent?.includes("direct BPM6 compilation begins in 2014"));
    assert.ok(notes?.querySelector('a[href="https://www.mof.go.jp/english/policy/international_policy/reference/iip/index.htm"]'));
  } finally {
    dom.window.close();
  }
});
