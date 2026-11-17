import * as Plot from "@observablehq/plot";
import { defineChartPage } from "../../../charts/definition.ts";

interface Row {
  year: number;
  state: number;
  tuition: number;
  other: number;
  cpi: number;
  estimated: boolean;
}
type View = "nominal" | "inflation" | "real";
const colors = ["#346a95", "#e7a34f", "#8a9b8c"];
const names = ["State appropriations", "Tuition and fees", "Other revenue"];
const cpi2025 = 321.9;
function parseData(value: unknown): Row[] {
  if (!Array.isArray(value) || value.length < 2) throw new TypeError("Expected observations.");
  let previous = 0;
  return value.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new TypeError(`Invalid row ${index}.`);
    const r = item as Record<string, unknown>;
    if (typeof r.year !== "number" || !Number.isInteger(r.year) || r.year <= previous ||
        ["state", "tuition", "other", "cpi"].some(k => typeof r[k] !== "number" || !Number.isFinite(r[k]) || (r[k] as number) <= 0) ||
        typeof r.estimated !== "boolean") throw new TypeError(`Invalid values in row ${index}.`);
    previous = r.year;
    return r as unknown as Row;
  });
}
function render(data: Row[], { document, width, height, mode }: {
  document: Document; width: number; height: number; mode: "interactive" | "static" | "preview";
}, view: View): SVGSVGElement {
  const compact = width < 600;
  const tall = Math.max(400, height);
  const legendFontSize = mode === "preview" ? 16 : compact ? 11 : 12;
  const legendItems: Array<{ name: string; x: number; row: number }> = [];
  let legendX = 8;
  let legendRow = 0;
  for (const name of names) {
    const itemWidth = 14 + 6 + name.length * legendFontSize * 0.57 + 16;
    if (legendX > 8 && legendX + itemWidth > width - 8) {
      legendRow++;
      legendX = 8;
    }
    legendItems.push({ name, x: legendX, row: legendRow });
    legendX += itemWidth;
  }
  const legendRows = legendRow + 1;
  const rows = data.map(row => ({ ...row, label: String(row.year) }));
  const marks: any[] = [];
  if (view === "inflation") {
    const indexed = rows.map(r => ({
      year: r.label,
      index: r.cpi / data[0]!.cpi * 100,
      tooltip: `${r.year}: CPI-U ${r.cpi.toFixed(1)}; ${(r.cpi / data[0]!.cpi * 100).toFixed(0)} (1979 = 100)`
    }));
    marks.push(Plot.lineY(indexed, { x: "year", y: "index", stroke: "#7557a6", strokeWidth: 3, marker: "circle" }));
    marks.push(Plot.dot(indexed, { x: "year", y: "index", fill: "#7557a6", r: 4, title: "tooltip", tip: mode === "interactive" }));
    marks.push(Plot.ruleY([100], { stroke: "#64748b", strokeDasharray: "4,4" }));
  } else {
    const values = rows.flatMap(r => {
      const factor = view === "real" ? cpi2025 / r.cpi : 1;
      return [
        { year: r.label, source: names[0], value: r.state * factor, estimated: r.estimated },
        { year: r.label, source: names[1], value: r.tuition * factor, estimated: r.estimated },
        { year: r.label, source: names[2], value: r.other * factor, estimated: r.estimated },
      ];
    }).map(r => ({...r, tooltip: `${r.year} • ${r.source}: $${r.value.toFixed(2)} billion${r.estimated ? " (estimated)" : ""}`}));
    marks.push(Plot.barY(values, Plot.stackY({ order: names }, {
      x: "year", y: "value", fill: "source", title: "tooltip",
      tip: mode === "interactive", insetLeft: 1, insetRight: 1, stroke: "#ffffff", strokeWidth: 0.6
    })));
  }
  const svg = Plot.plot({
    document,
    width,
    height: tall,
    marginTop: (mode === "preview" ? 48 : 36) + legendRows * (legendFontSize + 6),
    marginBottom: compact ? 66 : 52,
    marginLeft: compact ? 46 : 66,
    marginRight: 18,
    style: { fontSize: mode === "preview" ? "16px" : compact ? "11px" : "12px" },
    x: {
      label: null,
      domain: rows.map(r => r.label),
      ticks: compact ? rows.filter((_, i) => i % 2 === 0 || i === rows.length - 1).map(r => r.label) : undefined,
      tickSize: 0,
    },
    y: {
      label: view === "inflation" ? "1979 = 100" : "Billions of dollars",
      grid: true,
      zero: true,
      tickFormat: view === "inflation" ? d => String(d) : d => `$${d}B`,
    },
    color: { domain: names, range: colors, legend: false },
    marks
  }) as SVGSVGElement;
  if (view !== "inflation") {
    const ns = "http://www.w3.org/2000/svg";
    legendItems.forEach(({ name, x, row }) => {
      const y = 30 + (row + 1) * (legendFontSize + 6);
      const swatch = document.createElementNS(ns, "rect");
      swatch.setAttribute("x", String(x));
      swatch.setAttribute("y", String(y - legendFontSize));
      swatch.setAttribute("width", "14");
      swatch.setAttribute("height", String(legendFontSize));
      swatch.setAttribute("fill", colors[names.indexOf(name)]!);
      svg.append(swatch);
      const label = document.createElementNS(ns, "text");
      label.setAttribute("x", String(x + 20));
      label.setAttribute("y", String(y));
      label.setAttribute("font-size", String(legendFontSize));
      label.setAttribute("text-anchor", "start");
      label.setAttribute("fill", "#172323");
      label.textContent = name;
      svg.append(label);
    });
  }
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", view === "inflation"
    ? "CPI-U cumulative consumer price index, 1979 to 2025, for selected years."
    : `Stacked bars showing Michigan public university general fund revenue by source for selected years from 1979 to 2025 in ${view === "real" ? "inflation-adjusted 2025" : "nominal"} billions of dollars. The 1979 through 1997 figures are estimates.`);
  return svg;
}
export default defineChartPage<Row[]>({
  parseData,
  charts: [
    { id: "nominal", label: "Nominal revenue", alt: "Stacked general fund revenue in nominal billions of dollars.", render: (d, o) => render(d, o, "nominal") },
    { id: "inflation", label: "Inflation (CPI-U)", alt: "Cumulative US consumer inflation indexed to 1979.", render: (d, o) => render(d, o, "inflation") },
    { id: "real", label: "Revenue in 2025 dollars", alt: "Stacked general fund revenue adjusted to 2025 dollars.", render: (d, o) => render(d, o, "real") }
  ],
  previewChart: "nominal",
});
