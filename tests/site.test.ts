import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { promisify } from "node:util";
import pageData from "../src/pages/pages.11tydata.js";
import sharp from "sharp";

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
      for (const slug of ["anthropic-run-rates", "flux3-image-test", "japanese-financial-assets-abroad", "us-households-by-income-band", "kernel-cve-fixes"]) {
        assert.ok(homepage.includes(`href="/2026/${slug}/"`));
        assert.ok((await stat(path.join(output, "2026", slug, "index.html"))).isFile());
        await assert.rejects(stat(path.join(output, slug)), { code: "ENOENT" });
      }

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

      assert.deepEqual(
        await readFile(path.join(output, "assets/vendor/d3.v7.9.0.min.js")),
        await readFile("src/assets/vendor/d3.v7.9.0.min.js"),
      );
      const chartPage = path.join(output, "2026/kernel-cve-fixes");
      assert.deepEqual(
        await readFile(path.join(chartPage, "data.json")),
        await readFile("src/pages/2026/kernel-cve-fixes/data.json"),
      );
      const chartHtml = await readFile(path.join(chartPage, "index.html"), "utf8");
      assert.match(chartHtml, /type="module"\s+src="\/assets\/charts\/kernel-cve-fixes\.js"/);
      assert.match(chartHtml, /href="\.\/data\.json"/);
      assert.match(chartHtml, /href="\.\/data\.json" target="_blank" rel="noopener">View the source data \(JSON\)<\/a>/);
      assert.doesNotMatch(chartHtml, /\bdownload(?:\s|>)/);
      assert.doesNotMatch(chartHtml, /<details\b|id="table"|View values as a table/);
      assert.ok((await stat(path.join(output, "assets/charts/kernel-cve-fixes.js"))).size > 0);
      assert.match(chartHtml, /property="og:image" content="https:\/\/pages\.skybrian\.com\/assets\/charts\/kernel-cve-fixes\.png"/);
      const preview = await readFile(path.join(output, "assets/charts/kernel-cve-fixes.png"));
      const metadata = await sharp(preview).metadata();
      assert.equal(metadata.format, "png");
      assert.equal(metadata.width, 1200);
      assert.equal(metadata.height, 630);
      assert.ok(preview.length < 1_000_000);
      const { channels } = (await sharp(preview).stats());
      assert.ok(channels.some(channel => channel.min < channel.max), "preview is not blank");
      for (const script of ["chart.ts", "plot.ts", "preview.ts", "update-data.ts"]) {
        await assert.rejects(stat(path.join(chartPage, script)), { code: "ENOENT" });
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
