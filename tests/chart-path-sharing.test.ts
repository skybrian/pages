import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { it } from "node:test";
import { JSDOM } from "jsdom";
import { getSiteTestOutput } from "./helpers/site-build.ts";
import { assertStaticChartParity } from "./helpers/static-chart.ts";
import definition from "../src/pages/2026/michigan-university-funding/chart.ts";

it("publishes each chart view as a shareable static page with matching metadata and assets", async () => {
  const output = await getSiteTestOutput();
  const pageDirectory = path.join(output, "2026", "michigan-university-funding");
  for (const chart of definition.charts) {
    await assertStaticChartParity(
      new URL("../src/pages/2026/michigan-university-funding/", import.meta.url),
      definition,
      chart.id,
    );
    const htmlPath = path.join(pageDirectory, chart.id, "index.html");
    const dom = new JSDOM(await readFile(htmlPath, "utf8"), {
      url: `https://pages.skybrian.com/2026/michigan-university-funding/${chart.id}/`,
    });
    try {
      const { document } = dom.window;
      assert.equal(document.querySelector("[data-chart-root] svg")?.getAttribute("aria-label"), chart.alt);
      const tabs = [...document.querySelectorAll<HTMLButtonElement>("[data-chart-tabs] [data-chart-id]")];
      assert.equal(tabs.find((tab) => tab.getAttribute("aria-selected") === "true")?.dataset.chartId, chart.id);
      assert.equal(document.querySelector('meta[property="og:url"]')?.getAttribute("content"),
        `https://pages.skybrian.com/2026/michigan-university-funding/${chart.id}/`);
      const imageUrl = new URL(document.querySelector('meta[property="og:image"]')!.getAttribute("content")!);
      assert.equal(imageUrl.pathname.startsWith("/2026/michigan-university-funding/"), true);
      assert.ok(imageUrl.pathname.endsWith(".png"));
      await access(path.join(output, imageUrl.pathname.slice(1)));
      assert.equal(new URL(document.querySelector("base")!.getAttribute("href")!, dom.window.location.href).pathname, "/2026/michigan-university-funding/");
      assert.equal(new URL(
        document.querySelector('a[href="./data.json"]')!.getAttribute("href")!,
        new URL(document.querySelector("base")!.getAttribute("href")!, dom.window.location.href),
      ).pathname,
        "/2026/michigan-university-funding/data.json");
      assert.equal(new URL(
        document.querySelector('script[src="./chart.js"]')!.getAttribute("src")!,
        new URL(document.querySelector("base")!.getAttribute("href")!, dom.window.location.href),
      ).pathname,
        "/2026/michigan-university-funding/chart.js");
    } finally {
      dom.window.close();
    }
  }
  const baseDom = new JSDOM(await readFile(path.join(pageDirectory, "index.html"), "utf8"));
  try {
    assert.equal(baseDom.window.document.querySelector("[data-chart-root] svg")?.getAttribute("aria-label"),
      definition.charts[0]!.alt, "the canonical page keeps the first chart as its initial view");
    const baseImage = baseDom.window.document.querySelector('meta[property="og:image"]')!.getAttribute("content")!;
    assert.ok(baseImage.endsWith("/chart.png"), "the canonical page preserves the legacy chart.png social image URL");
    const homepage = new JSDOM(await readFile(path.join(output, "index.html"), "utf8"));
    try {
      assert.equal(homepage.window.document.querySelectorAll(
        'a[href="/2026/michigan-university-funding/"]',
      ).length, 1);
      assert.equal(homepage.window.document.querySelectorAll(
        'a[href^="/2026/michigan-university-funding/"][href$="/"]',
      ).length, 1, "view URLs do not become duplicate homepage entries");
    } finally {
      homepage.window.close();
    }
  } finally {
    baseDom.window.close();
  }
  assert.ok((await readFile(path.join(pageDirectory, "chart.png"))).subarray(0, 8).equals(
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  ), "the legacy chart.png URL remains a PNG");
});
