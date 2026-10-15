import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { it } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { JSDOM } from "jsdom";

const execFileAsync = promisify(execFile);
const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));

// Editorial copy belongs in test-owned fixtures, not assertions about live pages.
it("renders chart-page metadata and Markdown notes without an automatic subtitle", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "pages-chart-template-"));
  const title = "Fixture title & heading";
  const description = "Fixture summary & metadata";
  const fixtures = [
    ["with-summary", description, "2026-02-03"],
    ["without-summary", undefined, undefined],
    ["quoted-update", undefined, '"2026-02-04"'],
  ] as const;
  try {
    await mkdir(path.join(root, "src/_includes"), { recursive: true });
    await mkdir(path.join(root, "src/pages"), { recursive: true });
    await symlink(path.join(repositoryRoot, "node_modules"), path.join(root, "node_modules"), "dir");
    await writeFile(path.join(root, "package.json"), JSON.stringify({ type: "module" }));
    for (const file of [
      "_includes/base.njk", "_includes/chart-page.njk", "_includes/preview-ribbon.njk",
      "index.njk", "pages/pages.11tydata.js",
    ]) {
      await copyFile(path.join(repositoryRoot, "src", file), path.join(root, "src", file));
    }
    // Stub chart rendering: this test exercises the real templates, not charts.
    await writeFile(path.join(root, "eleventy.config.js"), `
      export default function(config) {
        config.addGlobalData("chartVendors", []);
        config.addGlobalData("previewMode", false);
        config.addFilter("initialCharts", (_, mode) =>
          mode === "tabs" ? '<div class="chart-tabs"></div>' : '<svg></svg>');
        config.addFilter("isoDate", date => new Date(date).toISOString().slice(0, 10));
        return { dir: { input: "src", output: "output" }, markdownTemplateEngine: false };
      }
    `);
    for (const [name, summary, updated] of fixtures) {
      const published = name === "quoted-update" ? "2025-12-31" : "2026-01-01";
      await writeFile(path.join(root, "src/pages", `${name}.md`), [
        "---", "layout: chart-page.njk", `title: ${JSON.stringify(title)}`, `date: ${published}`,
        ...(summary ? [`description: ${JSON.stringify(summary)}`] : []),
        ...(updated ? [`updated: ${updated}`] : []),
        "---", "", "## Fixture notes", "", "An **editable** explanation.",
        "", "[Fixture source](https://example.com/source)", "",
      ].join("\n"));
    }
    await execFileAsync(process.execPath, [
      path.join(repositoryRoot, "node_modules/@11ty/eleventy/cmd.cjs"),
    ], { cwd: root, env: { ...process.env, ELEVENTY_RUN_MODE: "build" } });
    const homepage = new JSDOM(await readFile(path.join(root, "output/index.html"), "utf8"));
    try {
      assert.equal(homepage.window.document.querySelector(".page-list li:last-child a")?.getAttribute("href"),
        "/quoted-update/", "a newer update date must not move an older publication ahead of newer pages");
      for (const [name, summary, updated] of fixtures) {
        const dom = new JSDOM(await readFile(path.join(root, "output", name, "index.html"), "utf8"));
        try {
          const document = dom.window.document;
          const card = document.querySelector(".chart-page")!;
          assert.equal(card.querySelector("h1")?.textContent, title);
          assert.equal(document.querySelector("title")?.textContent, `${title} · skybrian’s pages`);
          assert.equal(document.querySelector('meta[property="og:title"]')?.getAttribute("content"), title);
          for (const selector of ['meta[name="description"]', 'meta[property="og:description"]']) {
            assert.equal(document.querySelector(selector)?.getAttribute("content"), summary);
          }
          const entry = homepage.window.document.querySelector(`a[href="/${name}/"]`)!;
          assert.equal(entry.textContent, title);
          assert.equal(entry.parentElement?.querySelector("p")?.textContent, summary);
          const dates = entry.parentElement!.querySelector(".page-dates")!;
          const times = [...dates.querySelectorAll("time")];
          const updatedDate = updated?.replaceAll('"', "");
          const published = name === "quoted-update" ? "2025-12-31" : "2026-01-01";
          assert.equal(dates.textContent?.trim(), `${published}${updatedDate ? ` · updated ${updatedDate}` : ""}`);
          assert.deepEqual(times.map((time) => time.getAttribute("datetime")), [
            published, ...(updatedDate ? [updatedDate] : []),
          ]);
          assert.equal(card.querySelector("header")?.children.length, 1);
          assert.equal(card.querySelector("header")?.nextElementSibling?.className, "chart-tabs");
          assert.ok(!document.body.textContent?.includes(description));
          const notes = card.querySelector(".chart-notes");
          assert.equal(card.querySelector("[data-chart-root]")?.nextElementSibling, notes);
          assert.equal(notes?.querySelector("h2")?.textContent, "Fixture notes");
          assert.equal(notes?.querySelector("strong")?.textContent, "editable");
          assert.equal(notes?.querySelector("a")?.getAttribute("href"), "https://example.com/source");
        } finally {
          dom.window.close();
        }
      }
    } finally {
      homepage.window.close();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
