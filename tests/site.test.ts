import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import pageData from "../src/pages/pages.11tydata.js";
import sharp from "sharp";
import { JSDOM } from "jsdom";
import { chartVendors } from "../scripts/chart-vendor.js";
import { getSiteTestOutput } from "./helpers/site-build.ts";

const repositoryRoot = path.resolve(fileURLToPath(new URL("../", import.meta.url)));

async function findSources(root: string, include: (name: string) => boolean): Promise<string[]> {
  const sources: string[] = [];
  async function walk(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (entry.name !== "tests") await walk(path.join(directory, entry.name));
      } else if (entry.isFile() && include(entry.name)) {
        sources.push(path.relative(root, path.join(directory, entry.name)));
      }
    }
  }
  await walk(root);
  return sources.sort();
}

async function findPages(root: string) {
  const sources = await findSources(root, (name) => /\.(?:md|njk|html)$/.test(name));
  return sources.map((source) => {
    const stem = source.replace(/\.[^.]+$/, "").split(path.sep).join("/");
    const route = pageData.eleventyComputed.permalink({ page: { filePathStem: `/pages/${stem}` } });
    const [year, ...segments] = route.split("/").filter(Boolean);
    const legacyRoute = /^\d{4}$/.test(year ?? "") && segments.length ? segments.join("/") : undefined;
    return { route, legacyRoute };
  });
}

describe("year-based page URLs", () => {
  it("discovers standalone, nested, and year-index pages without treating tests as pages", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "pages-source-discovery-"));
    try {
      for (const source of [
        "2026/standalone.html", "2026/template.njk", "2027/index.md",
        "2027/nested/post/index.md", "2026/post/tests/fixtures/leak.md", "2026/helper.ts",
      ]) {
        const file = path.join(root, source);
        await mkdir(path.dirname(file), { recursive: true });
        await writeFile(file, "");
      }
      assert.deepEqual(await findPages(root), [
        { route: "/2026/standalone/", legacyRoute: "standalone" },
        { route: "/2026/template/", legacyRoute: "template" },
        { route: "/2027/", legacyRoute: undefined },
        { route: "/2027/nested/post/", legacyRoute: "nested/post" },
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("preserves years and nested directories for standalone and index pages", () => {
    const permalink = pageData.eleventyComputed.permalink;
    for (const [stem, expected] of [
      ["/pages/2026/example-post", "/2026/example-post/"],
      ["/pages/2026/image-post/index", "/2026/image-post/"],
      ["/pages/2027/new-post/index", "/2027/new-post/"],
      ["/pages/2027/nested/new-post", "/2027/nested/new-post/"],
      ["/pages/2027/index", "/2027/"],
    ]) {
      assert.equal(permalink({ page: { filePathStem: stem! } }), expected);
    }
  });

  it("builds year-based pages, homepage links, images, and legacy redirect rules", async () => {
    const output = await getSiteTestOutput();
    const pagesRoot = path.join(repositoryRoot, "src/pages");

    const homepage = await readFile(path.join(output, "index.html"), "utf8");
    assert.doesNotMatch(homepage, /preview-ribbon|\/admin\/files\//,
      "production output must not expose preview ribbon markup or source links");
    for (const { route, legacyRoute } of await findPages(pagesRoot)) {
      const outputDirectory = path.join(output, route.slice(1));
      assert.ok(homepage.includes(`href="${route}"`), `homepage links to ${route}`);
      assert.ok((await stat(path.join(outputDirectory, "index.html"))).isFile(),
        `built page exists at ${outputDirectory}`);
      assert.ok((await readFile(path.join(outputDirectory, "index.html"), "utf8"))
        .includes('href="/assets/style.css"'), `${route} includes the shared stylesheet`);
      if (legacyRoute) {
        await assert.rejects(
          stat(path.join(output, legacyRoute)),
          { code: "ENOENT" },
        );
      }
    }

    for (const vendor of chartVendors) {
      assert.deepEqual(
        await readFile(path.join(output, vendor.url)),
        await readFile(path.resolve(repositoryRoot, vendor.source)),
      );
      assert.deepEqual(
        await readFile(path.join(output, vendor.licenseUrl)),
        await readFile(path.resolve(repositoryRoot, vendor.license)),
      );
    }
    for (const source of await findSources(pagesRoot, (name) => name === "chart.ts")) {
      const relativeDirectory = path.dirname(source);
      const chartPage = path.join(output, relativeDirectory);
      const route = `/${relativeDirectory.split(path.sep).join("/")}/`;
      const pageLabel = relativeDirectory.split(path.sep).join("/");
      assert.deepEqual(
        await readFile(path.join(chartPage, "data.json")),
        await readFile(path.join(pagesRoot, relativeDirectory, "data.json")),
      );
      const chartHtml = await readFile(path.join(chartPage, "index.html"), "utf8");
      const dom = new JSDOM(chartHtml, {
        url: `https://pages.example${route}`,
        runScripts: "outside-only",
      });
      try {
        const document = dom.window.document;
        assert.ok(document.body.classList.contains("chart-layout"));
        const backNav = document.querySelector("nav.chart-back");
        assert.equal(backNav?.parentElement, document.querySelector("main"));
        const backLink = backNav?.querySelector("a");
        assert.equal(backLink?.getAttribute("href"), "/");
        assert.equal(backLink?.getAttribute("aria-label"), "Back to index");
        assert.equal(backLink?.textContent, "←");
        const card = document.querySelector(".chart-page");
        assert.equal(backNav?.nextElementSibling, card, "the back arrow sits above the chart card");
        assert.equal(card?.querySelector("h1")?.id, "chart-heading",
          "the compact heading belongs to the chart card");
        assert.equal(card?.getAttribute("aria-labelledby"), "chart-heading");
        assert.equal(card?.querySelector("header")?.nextElementSibling?.className, "chart-tabs",
          "the chart controls follow the heading without an automatic subtitle");
        const initialTabs = card?.querySelector<HTMLElement>("[data-chart-tabs]");
        assert.ok(initialTabs, "render the chart tab container before JavaScript loads");
        const tabButtons = [...initialTabs.querySelectorAll('[role="tab"]')];
        if (initialTabs.hidden) {
          assert.equal(tabButtons.length, 0, "single-chart pages hide the empty tab container");
        } else {
          assert.ok(tabButtons.length > 1, "visible tabs must represent multiple chart views");
          assert.equal(tabButtons.filter((tab) => tab.getAttribute("aria-selected") === "true").length, 1,
            "exactly one chart view is initially selected");
        }
        assert.equal(document.querySelector("[data-chart-root] img"), null,
          "the on-page chart must not use the social preview PNG");
        const staticCharts = document.querySelectorAll("[data-chart-root] .chart-static svg");
        assert.equal(staticCharts.length, 3, "pre-render compact, medium, and wide SVG layouts");
        for (const svg of staticCharts) {
          assert.equal(svg.getAttribute("role"), "img");
          assert.ok(svg.getAttribute("aria-label"));
          assert.ok(svg.querySelector("text"), "the initial chart already includes its labels");
        }
        const notes = card?.querySelector(".chart-notes");
        assert.ok(notes, "render the Markdown notes container inside the rounded card");
        assert.equal(card?.querySelector("[data-chart-root]")?.nextElementSibling, notes,
          "chart notes follow the chart inside the card");
        const actions = document.querySelector(".chart-actions");
        assert.equal(card?.querySelector(".chart-actions"), null, "chart actions are outside the rounded card");
        assert.equal(card?.nextElementSibling, actions, "chart actions sit directly below the card");
        assert.equal(actions?.firstElementChild?.getAttribute("href"), "./data.json");
        assert.ok(actions?.lastElementChild?.hasAttribute("data-copy-svg"),
          "the copy button shares the footer row with the data link");
        assert.ok(actions?.nextElementSibling?.hasAttribute("data-copy-status"),
          "copy feedback sits below the footer without shifting its controls");
        const scripts = [...document.querySelectorAll("script[src]")];
        assert.deepEqual(scripts.map(script => script.getAttribute("src")), [
          ...chartVendors.map(vendor => vendor.url), "./chart.js",
        ], "load D3 and Plot before the independent page entry");
        assert.ok(scripts.slice(0, 2).every(script => script.hasAttribute("defer")));
        assert.equal(scripts.at(-1)?.getAttribute("type"), "module");

        // Execute the actual vendor distributions and browser bundle, not
        // the npm rendering imports, to catch adapter/API mismatches.
        const browserData = JSON.parse(await readFile(path.join(chartPage, "data.json"), "utf8"));
        dom.window.fetch = async () => new Response(JSON.stringify(browserData));
        for (const vendor of chartVendors) {
          dom.window.eval(await readFile(path.join(output, vendor.url), "utf8"));
        }
        const bundle = await readFile(path.join(chartPage, "chart.js"), "utf8");
        assert.ok(Buffer.byteLength(bundle) < 100_000, "large libraries must stay outside page bundles");
        dom.window.eval(bundle);
        for (let attempt = 0; attempt < 100 && document.querySelector("[data-chart-root]")?.getAttribute("aria-busy") === "true"; attempt++) {
          await new Promise(resolve => setTimeout(resolve, 10));
        }
        assert.equal(document.querySelector("[data-chart-root]")?.getAttribute("aria-busy"), "false");
        assert.equal(document.querySelectorAll("[data-chart-root] > svg").length, 1,
          `${pageLabel}: browser enhancement must replace the static layouts with a live chart`);
        assert.ok(!document.querySelector("[data-copy-status]")?.textContent?.includes("unavailable"));
      } finally {
        dom.window.close();
      }
      assert.ok(chartHtml.includes('src="./chart.js"'));
      assert.match(chartHtml, /href="\.\/data\.json"[^>]*target="_blank"[^>]*rel="noopener"/);
      assert.doesNotMatch(chartHtml, /\bdownload(?:\s|>)/);
      assert.ok((await stat(path.join(chartPage, "chart.js"))).size > 0);
      await assert.rejects(stat(path.join(output, "assets/charts", `${path.basename(relativeDirectory)}.js`)), { code: "ENOENT" });
      assert.ok(chartHtml.includes(`property="og:image" content="https://pages.skybrian.com${route}chart.png"`));
      const preview = await readFile(path.join(chartPage, "chart.png"));
      const metadata = await sharp(preview).metadata();
      assert.equal(metadata.format, "png");
      assert.equal(metadata.width, 1200);
      assert.equal(metadata.height, 630);
      assert.ok(preview.length < 1_000_000);
      const { channels } = await sharp(preview).stats();
      assert.ok(channels.some(channel => channel.min < channel.max), `${pageLabel} preview is not blank`);
      for (const script of ["chart.ts", "plot.ts", "preview.ts", "update-data.ts"]) {
        await assert.rejects(stat(path.join(chartPage, script)), { code: "ENOENT" });
      }
    }
    await assert.rejects(stat(path.join(output, "assets/charts")), { code: "ENOENT" });
    const redirects = await readFile(path.join(output, "_redirects"), "utf8");
    assert.equal(redirects, await readFile(path.join(repositoryRoot, "src/_redirects"), "utf8"));
    for (const slug of ["anthropic-run-rates", "flux3-image-test"]) {
      for (const suffix of ["", "/", "/*"]) {
        const destination = suffix === "/*" ? ":splat" : "";
        assert.ok(redirects.split("\n").some(line => {
          const [from, to, status] = line.trim().split(/\s+/);
          return from === `/${slug}${suffix}`
            && to === `/2026/${slug}/${destination}`
            && status === "301!";
        }));
      }
    }
  });
});
