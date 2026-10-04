import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { buildSync } from "esbuild";
import { runInNewContext } from "node:vm";
import { it } from "node:test";
import { JSDOM } from "jsdom";

const chartPath = "src/pages/2026/kernel-cve-fixes/chart.ts";
const page = await readFile("src/pages/2026/kernel-cve-fixes/index.md", "utf8");
const data = JSON.parse(await readFile("src/pages/2026/kernel-cve-fixes/data.json", "utf8")) as unknown;
const compiled = buildSync({
  entryPoints: [chartPath],
  bundle: true,
  external: ["@observablehq/plot"],
  format: "cjs",
  platform: "node",
  write: false,
}).outputFiles[0]!.text;

type Row = { version: string; count: number };
type PlotOptions = {
  width: number;
  height: number;
  x: { domain: string[]; ticks: string[]; label: string | null };
  y: { domain: number[]; label: string | null };
  marks: Array<{ kind: string; data: Row[]; options?: Record<string, unknown> }>;
};

function loadDefinition() {
  let options: PlotOptions | undefined;
  const document = new JSDOM().window.document;
  const Plot = {
    plot(value: PlotOptions) {
      options = value;
      return document.createElementNS("http://www.w3.org/2000/svg", "svg");
    },
    lineY(rows: Row[], config: Record<string, unknown>) { return { kind: "line", data: rows, options: config }; },
    dot(rows: Row[], config: Record<string, unknown>) { return { kind: "dot", data: rows, options: config }; },
    tip(rows: Row[], config: unknown) { return { kind: "tip", data: rows, options: config }; },
    pointerX(config: unknown) { return config; },
  };
  const cjs = { exports: {} as Record<string, unknown> };
  runInNewContext(compiled, {
    module: cjs,
    exports: cjs.exports,
    require(name: string) {
      assert.equal(name, "@observablehq/plot");
      return Plot;
    },
  });
  const exports = cjs.exports as { default: { parseData(value: unknown): { metadata: unknown; releases: Row[] }; charts: Array<{
    id: string; label: string; alt: string;
    render(data: { metadata: unknown; releases: Row[] }, context: { document: Document; width: number; height: number; mode: "interactive" | "preview" }): SVGSVGElement;
  }>; previewChart?: string } };
  return { definition: exports.default, document, get options() { return options!; } };
}

it("uses the shared chart-page layout and links to the kernel CVE source", () => {
  assert.match(page, /^layout: chart-page\.njk$/m);
  assert.match(page, /^title: .+$/m);
  assert.match(page, /kernel\.googlesource\.com\/pub\/scm\/linux\/security\/vulns/);
  assert.doesNotMatch(page, /source commit/i);
});

it("parses the published dataset and rejects invalid release rows", () => {
  const { definition } = loadDefinition();
  const parsed = definition.parseData(data);
  assert.ok(parsed.releases.length > 0);
  assert.equal(parsed.releases[0]!.version, "6.9");
  assert.equal(parsed.releases.at(-1)!.version, "7.2");
  assert.throws(() => definition.parseData(null), /not an object/);
  assert.throws(() => definition.parseData({ metadata: {}, releases: [] }), /missing metadata or release counts/);
  assert.throws(() => definition.parseData({ metadata: {}, releases: [{ version: "6.9", count: -1 }] }), /invalid release count/);
});

it("exposes a chart definition and renders interactive and preview SVGs", () => {
  const loaded = loadDefinition();
  const { definition, document } = loaded;
  assert.equal(definition.previewChart, "kernel-cve-fixes");
  assert.equal(definition.charts.length, 1);
  const chart = definition.charts[0]!;
  assert.equal(chart.id, "kernel-cve-fixes");
  assert.match(chart.label, /Published CVE/);
  assert.match(chart.alt, /Line chart/);
  const sample = definition.parseData({
    metadata: { start: "6.9", through: "7.2" },
    releases: [
      { version: "6.10", count: 4 },
      { version: "6.9", count: 2 },
      { version: "7.2", count: 9 },
      { version: "7.1", count: 0 },
    ],
  });

  const interactive = chart.render(sample, { document, width: 800, height: 448, mode: "interactive" });
  assert.equal(interactive.namespaceURI, "http://www.w3.org/2000/svg");
  assert.equal(interactive.classList.contains("plot"), true);
  const interactiveOptions = loaded.options;
  assert.deepEqual([...interactiveOptions.x.domain], ["6.9", "6.10", "7.1", "7.2"]);
  assert.deepEqual([...interactiveOptions.y.domain], [0, 9]);
  assert.equal(interactiveOptions.x.label, "Mainline kernel release");
  assert.equal(interactiveOptions.y.label, null);
  assert.ok(interactiveOptions.marks.some((mark) => mark.kind === "tip"));
  const dots = interactiveOptions.marks.find((mark) => mark.kind === "dot")!;
  const title = dots.options!.title as (row: Row) => string;
  assert.equal(title(sample.releases[0]!), "Linux 6.10: 4 published CVEs");

  const preview = chart.render(sample, { document, width: 1120, height: 570, mode: "preview" });
  assert.equal(preview.namespaceURI, "http://www.w3.org/2000/svg");
  const previewOptions = loaded.options;
  assert.equal(previewOptions.x.label, null);
  assert.equal(previewOptions.y.label, null);
  assert.equal(previewOptions.marks.some((mark) => mark.kind === "tip"), false);
});

it("uses a finite nonzero y-domain when every release count is zero", () => {
  const loaded = loadDefinition();
  const { definition, document } = loaded;
  const chart = definition.charts[0]!;
  const data = definition.parseData({
    metadata: { start: "6.9", through: "6.10" },
    releases: [
      { version: "6.10", count: 0 },
      { version: "6.9", count: 0 },
    ],
  });

  chart.render(data, { document, width: 800, height: 448, mode: "interactive" });
  assert.deepEqual([...loaded.options.y.domain], [0, 1]);
  assert.ok(loaded.options.y.domain.every(Number.isFinite));
});
