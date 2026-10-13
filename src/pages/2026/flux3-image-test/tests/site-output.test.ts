import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { it } from "node:test";
import { JSDOM } from "jsdom";
import { getSiteTestOutput } from "../../../../../tests/helpers/site-build.ts";

it("preserves the generated image file and its page reference", async () => {
  const output = await getSiteTestOutput();
  const image = "flux3image-a-woman-playing-accordion.png";
  const pageDirectory = path.join(output, "2026", "flux3-image-test");
  assert.deepEqual(
    await readFile(path.join(pageDirectory, image)),
    await readFile(new URL(`../${image}`, import.meta.url)),
  );

  const html = await readFile(path.join(pageDirectory, "index.html"), "utf8");
  const dom = new JSDOM(html);
  try {
    assert.equal(dom.window.document.querySelector("figure.image-post img")?.getAttribute("src"), image);
  } finally {
    dom.window.close();
  }
});
