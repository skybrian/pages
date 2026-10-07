import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { promisify } from "node:util";
import pageData from "../src/pages/pages.11tydata.js";
import sharp from "sharp";
import { JSDOM } from "jsdom";
import { chartVendors } from "../scripts/chart-vendor.js";

describe("year-based page URLs", () => {
  it("preserves years and nested directories for standalone and index pages", () => {
    const permalink = pageData.eleventyComputed.permalink;
    for (const [stem, expected] of [
      ["/pages/2026/anthropic-run-rates", "/2026/anthropic-run-rates/"],
      ["/pages/2026/flux3-image-test/index", "/2026/flux3-image-test/"],
      ["/pages/2027/new-post/index", "/2027/new-post/"],
      ["/pages/2027/nested/new-post", "/2027/nested/new-post/"],
      ["/pages/2027/index", "/2027/"],
    ]) {
      assert.equal(permalink({ page: { filePathStem: stem! } }), expected);
    }
  });

  it("builds year-based pages, homepage links, images, and legacy redirect rules", async () => {
    const output = await mkdtemp(path.join(tmpdir(), "pages-site-test-"));
    try {
      await promisify(execFile)(process.execPath, [
        "node_modules/@11ty/eleventy/cmd.cjs",
        `--output=${output}`,
      ], { env: { ...process.env, ELEVENTY_RUN_MODE: "build" } });

      const homepage = await readFile(path.join(output, "index.html"), "utf8");
      assert.doesNotMatch(homepage, /preview-ribbon|\/admin\/files\//,
        "production output must not expose preview ribbon markup or source links");
      for (const slug of ["anthropic-run-rates", "flux3-image-test", "japanese-financial-assets-abroad", "us-households-by-income-band", "kernel-cve-fixes"]) {
        assert.ok(homepage.includes(`href="/2026/${slug}/"`));
        assert.ok((await stat(path.join(output, "2026", slug, "index.html"))).isFile());
        await assert.rejects(stat(path.join(output, slug)), { code: "ENOENT" });
      }

      const kernelEntry = homepage.match(/<li>\s*<a href="\/2026\/kernel-cve-fixes\/">[\s\S]*?<\/li>/)?.[0];
      assert.ok(kernelEntry);
      assert.ok(kernelEntry.includes("A chart of CSVs fixed by Linux kernel releases"));

      const image = "flux3image-a-woman-playing-accordion.png";
      assert.deepEqual(
        await readFile(path.join(output, "2026/flux3-image-test", image)),
        await readFile(path.join("src/pages/2026/flux3-image-test", image)),
      );
      const imagePost = await readFile(
        path.join(output, "2026/flux3-image-test/index.html"), "utf8",
      );
      assert.ok(imagePost.includes(`src="${image}"`));
      assert.ok(imagePost.includes('href="/assets/style.css"'));

      for (const vendor of chartVendors) {
        assert.deepEqual(
          await readFile(path.join(output, vendor.url)),
          await readFile(vendor.source),
        );
        assert.deepEqual(
          await readFile(path.join(output, vendor.licenseUrl)),
          await readFile(vendor.license),
        );
      }
      for (const slug of ["kernel-cve-fixes", "us-households-by-income-band", "anthropic-run-rates", "japanese-financial-assets-abroad"]) {
        const chartPage = path.join(output, "2026", slug);
        assert.deepEqual(
          await readFile(path.join(chartPage, "data.json")),
          await readFile(path.join("src/pages/2026", slug, "data.json")),
        );
        const chartHtml = await readFile(path.join(chartPage, "index.html"), "utf8");
        const dom = new JSDOM(chartHtml, {
          url: `https://pages.example/2026/${slug}/`,
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
          assert.equal(initialTabs?.hidden, slug !== "us-households-by-income-band",
            "reserve multi-chart tab space before JavaScript loads");
          const description = document.querySelector('meta[name="description"]')?.getAttribute("content");
          if (slug !== "anthropic-run-rates" && slug !== "kernel-cve-fixes") {
            assert.ok(description, "retain the page description as metadata");
            assert.equal(document.querySelector('meta[property="og:description"]')?.getAttribute("content"), description);
            assert.ok(homepage.includes(description), "retain the description in homepage summaries");
            assert.ok(!document.body.textContent?.includes(description), "do not repeat metadata as visible prose");
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
          assert.ok(notes?.textContent?.includes("Source"), "chart sources belong inside the rounded card");
          assert.equal(card?.querySelector("[data-chart-root]")?.nextElementSibling, notes,
            "chart notes follow the chart inside the card");
          if (slug === "japanese-financial-assets-abroad") {
            assert.ok(notes?.textContent?.includes("BPM5 to BPM6"), "retain the methodology note inside the card");
            assert.ok(notes?.querySelector('a[href="https://www.mof.go.jp/english/policy/international_policy/reference/iip/index.htm"]'),
              "retain the source link");
          }
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
            `${slug}: browser enhancement must replace the static layouts with a live chart`);
          assert.ok(!document.querySelector("[data-copy-status]")?.textContent?.includes("unavailable"));
        } finally {
          dom.window.close();
        }
        assert.ok(chartHtml.includes('src="./chart.js"'));
        assert.match(chartHtml, /href="\.\/data\.json"[^>]*target="_blank"[^>]*rel="noopener"/);
        assert.doesNotMatch(chartHtml, /\bdownload(?:\s|>)/);
        assert.ok((await stat(path.join(chartPage, "chart.js"))).size > 0);
        await assert.rejects(stat(path.join(output, "assets/charts", `${slug}.js`)), { code: "ENOENT" });
        assert.ok(chartHtml.includes(`property="og:image" content="https://pages.skybrian.com/assets/charts/${slug}.png"`));
        const preview = await readFile(path.join(output, "assets/charts", `${slug}.png`));
        const metadata = await sharp(preview).metadata();
        assert.equal(metadata.format, "png");
        assert.equal(metadata.width, 1200);
        assert.equal(metadata.height, 630);
        assert.ok(preview.length < 1_000_000);
        const { channels } = await sharp(preview).stats();
        assert.ok(channels.some(channel => channel.min < channel.max), `${slug} preview is not blank`);
        for (const script of ["chart.ts", "plot.ts", "preview.ts", "update-data.ts"]) {
          await assert.rejects(stat(path.join(chartPage, script)), { code: "ENOENT" });
        }
      }
      const redirects = await readFile(path.join(output, "_redirects"), "utf8");
      assert.equal(redirects, await readFile("src/_redirects", "utf8"));
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
    } finally {
      await rm(output, { recursive: true, force: true });
    }
  });
});
