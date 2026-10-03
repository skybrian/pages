import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { buildSync } from "esbuild";
import { runInNewContext } from "node:vm";
import { it } from "node:test";

const chartPath = "src/pages/2026/kernel-cve-fixes/chart.ts";
const source = await readFile(chartPath, "utf8");
const page = await readFile("src/pages/2026/kernel-cve-fixes/index.html", "utf8");
const requestedTitle = "A chart of CSVs fixed by Linux kernel releases";
it("uses the requested title and keeps only the chart card", () => {
  assert.match(page, new RegExp(`^title: ${requestedTitle.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")}$`, "m"));
  assert.match(page, new RegExp(`<title>${requestedTitle}</title>`));
  assert.match(page, new RegExp(`<h1 class="chart-heading" id="chart-heading">${requestedTitle}</h1>`));
  const outsideCard = page.split('<article class="chart-card"')[0] + page.split("</article>")[1];
  assert.doesNotMatch(outsideCard, /<nav\\b|<header\\b|<footer\\b|class="method"/);
});
const compiled = buildSync({
  stdin: { contents: source, loader: "ts", resolveDir: process.cwd() },
  bundle: false,
  format: "cjs",
  platform: "node",
  write: false,
}).outputFiles[0]!.text;

type Row = { version: string; count: number };
type PlotOptions = {
  width: number;
  x: { domain: string[]; ticks: string[] };
  y: { domain: number[] };
  marks: Array<{ kind: string; data: Row[]; options?: Record<string, unknown> }>;
};

function dataset(releases: Row[]) {
  return {
    metadata: {
      source: "https://example.test/source",
      commit: "a".repeat(40),
      asOf: "2026-10-02T08:28:22Z",
      start: "6.9",
      through: "7.2",
      method: "fixture",
      coverage: { publishedCves: 2, missingDyads: 0, missingDyadIds: [] },
    },
    releases,
  };
}

async function runChart(releases: Row[], initialWidth: number) {
  let width = initialWidth;
  let resizeCallback: (() => void) | undefined;
  let renderAfterResize: (() => void) | undefined;
  let fetchCalls = 0;
  const plots: PlotOptions[] = [];
  const chart = {
    get clientWidth() { return width; },
    setAttribute() {},
    replaceChildren() {},
    classList: { add() {} },
  };
  const releaseRange = { textContent: "" };
  const provenance = {
    textContent: "",
    replaceChildren(...children: Array<string | { textContent: string }>) {
      this.textContent = children.map((child) =>
        typeof child === "string" ? child : child.textContent).join("");
    },
  };
  const document = {
    createElement() { return { textContent: "", href: "", rel: "" }; },
    querySelector(selector: string) {
      if (selector === "#chart") return chart;
      if (selector === "#release-range") return releaseRange;
      if (selector === "#provenance") return provenance;
      return null;
    },
  };
  const Plot = {
    plot(options: PlotOptions) {
      plots.push(options);
      return chart;
    },
    lineY(data: Row[], options: Record<string, unknown>) {
      return { kind: "line", data, options };
    },
    dot(data: Row[], options: Record<string, unknown>) {
      return { kind: "dot", data, options };
    },
    tip(data: Row[], options: unknown) {
      return { kind: "tip", data, options };
    },
    pointerX(options: unknown) { return options; },
  };

  runInNewContext(compiled, {
    require(name: string) {
      assert.equal(name, "@observablehq/plot");
      return Plot;
    },
    document,
    window: {
      addEventListener(_name: string, callback: () => void) { resizeCallback = callback; },
      clearTimeout() {},
      setTimeout(callback: () => void) { renderAfterResize = callback; return 1; },
    },
    fetch: async () => {
      fetchCalls++;
      return { ok: true, json: async () => dataset(releases) };
    },
    Intl,
    Date,
    URL,
  });

  const flushPromises = async () => {
    // The chart starts rendering at module evaluation and awaits fetch().json().
    await new Promise<void>((resolve) => setImmediate(resolve));
    await new Promise<void>((resolve) => setImmediate(resolve));
  };
  await flushPromises();
  return {
    plots,
    releaseRange,
    provenance,
    get fetchCalls() { return fetchCalls; },
    resize: async (newWidth: number) => {
      width = newWidth;
      resizeCallback!();
      renderAfterResize!();
      await flushPromises();
    },
  };
}

it("renders sorted categorical releases with a finite y-domain and responsive ticks", async () => {
  const rows = [
    { version: "6.10", count: 4 },
    { version: "6.9", count: 2 },
    { version: "7.2", count: 9 },
    { version: "7.1", count: 0 },
  ];
  const chart = await runChart(rows, 360);
  const options = chart.plots[0]!;

  assert.deepEqual([...options.x.domain], ["6.9", "6.10", "7.1", "7.2"]);
  assert.deepEqual([...options.y.domain], [0, 9]);
  assert.ok(options.y.domain.every(Number.isFinite));
  assert.ok(options.x.ticks.length < options.x.domain.length);
  const dots = options.marks.find((mark) => mark.kind === "dot")!;
  assert.deepEqual([...dots.data].map((row) => row.version), [...options.x.domain]);

  const title = dots.options!.title as (row: Row) => string;
  assert.equal(title(rows[0]!), "Linux 6.10: 4 published CVEs");
  assert.equal(typeof title(rows[0]!), "string");
  const tip = options.marks.find((mark) => mark.kind === "tip")!;
  const pointer = tip.options as { title: (row: Row) => string };
  assert.equal(
    pointer.title(rows[0]!),
    "Linux 6.10\n4 published CVE records with fixes",
  );
  assert.equal(chart.releaseRange.textContent, "Linux 6.9–7.2");
  assert.equal(
    chart.provenance.textContent,
    "Source: Linux kernel security vulnerability repository. Source commit aaaaaaaaaaaa.",
  );

  await chart.resize(900);
  assert.equal(chart.plots.length, 2);
  assert.deepEqual([...chart.plots[1]!.x.ticks], [...chart.plots[1]!.x.domain]);
  assert.equal(chart.fetchCalls, 1);
});

it("uses a finite nonzero y-domain when every release count is zero", async () => {
  const chart = await runChart([
    { version: "6.10", count: 0 },
    { version: "6.9", count: 0 },
  ], 800);

  assert.deepEqual([...chart.plots[0]!.y.domain], [0, 1]);
  assert.ok(chart.plots[0]!.y.domain.every(Number.isFinite));
});
