import * as Plot from "@observablehq/plot";
import { defineChartPage } from "../../../charts/definition.ts";

const categories = [
  "Portfolio investment", "Direct investment", "Other investment",
  "Reserve assets", "Financial derivatives",
] as const;
const colors = ["#2563eb", "#0891b2", "#d97706", "#7c3aed", "#64748b"];
type Category = typeof categories[number];
type Row = { year: number } & Record<Category, number>;
type Segment = { year: number; category: Category; value: number };

function parseData(value: unknown): Row[] {
  if (!Array.isArray(value) || value.length === 0) throw new TypeError("Expected annual financial asset data.");
  return value.map((item, index) => {
    if (!item || typeof item !== "object") throw new TypeError(`Invalid row ${index}.`);
    const row = item as Record<string, unknown>;
    if (!Number.isInteger(row.year) || categories.some((key) => typeof row[key] !== "number" || !Number.isFinite(row[key]))) {
      throw new TypeError(`Invalid values in row ${index}.`);
    }
    return row as Row;
  });
}

export default defineChartPage<Row[]>({
  parseData,
  charts: [{
    id: "assets",
    label: "Gross financial assets abroad by category",
    alt: "Stacked area chart of Japan's gross external financial assets by category from 1996 to 2025, in trillions of yen, with the BPM6 transition marked at 2014.",
    render(data, { document, width, height, mode }) {
      // Keep each category's observations contiguous so Plot draws one area
      // path per series rather than individual inter-year polygons.
      const segments: Segment[] = categories.flatMap((category) => data.map((row) => ({
        year: row.year, category, value: row[category],
      })));
      const latest = data.at(-1)!;
      const total = categories.reduce((sum, category) => sum + latest[category], 0);
      // The five-item legend needs more than 800px at desktop font size; use
      // compact axes and legend sizing before the available chart column gets
      // narrow enough for the original fixed desktop layout to collide.
      const compact = width < 900;
      const legendFontSize = mode === "preview" ? 16 : compact ? 11 : 13;
      const legendItems: Array<{ category: Category; x: number; row: number }> = [];
      let legendX = 8;
      let legendRow = 0;
      const legendRight = width - 8;
      categories.forEach((category) => {
        const itemWidth = 14 + 6 + category.length * legendFontSize * 0.57 + 16;
        if (legendX > 8 && legendX + itemWidth > legendRight) {
          legendRow++;
          legendX = 8;
        }
        legendItems.push({ category, x: legendX, row: legendRow });
        legendX += itemWidth;
      });
      const legendRows = legendRow + 1;
      const marginTop = compact ? 46 : 80;
      const marginLeft = compact ? 48 : 95;
      const marginRight = compact ? 24 : 48;
      const renderHeight = mode === "interactive" ? Math.max(height, 420) : height;
      const marginBottom = compact ? Math.min(renderHeight * 0.55, 42 + legendRows * 18) : 90;
      const svg = Plot.plot({
        document, width, height: renderHeight,
        marginTop, marginRight, marginBottom, marginLeft,
        style: { fontSize: mode === "preview" ? "16px" : "12px" },
        x: { domain: [1996, 2025], ticks: compact ? [1996, 2005, 2015, 2025] : [1996, 2000, 2005, 2010, 2015, 2020, 2025], tickFormat: (year) => String(year), label: null },
        y: { domain: [0, 2000], ticks: compact ? [0, 1000, 2000] : [0, 500, 1000, 1500, 2000], label: compact ? null : "Trillions of yen", grid: true },
        color: { domain: categories, range: colors, legend: false },
        marks: [
          Plot.areaY(segments, { x: "year", y: "value", z: "category", fill: "category",
            curve: "linear",
            tip: mode === "interactive" }),
          Plot.ruleX([2014], { stroke: "#111827", strokeWidth: 1.5, strokeDasharray: "6,5" }),
          Plot.text([{ year: 2014, value: compact ? 1960 : 1930, label: "BPM6 from 2014" }],
            { x: "year", y: "value", text: "label", dx: compact ? -8 : 8,
              textAnchor: compact ? "end" : "start", fontSize: compact ? 11 : 12 }),
        ],
      }) as unknown as SVGSVGElement;
      const ns = "http://www.w3.org/2000/svg";
      const totalLabel = document.createElementNS(ns, "text");
      totalLabel.setAttribute("x", String(width - 48));
      totalLabel.setAttribute("y", String(marginTop + (1 - total / 2000) * (renderHeight - marginTop - marginBottom)));
      totalLabel.setAttribute("font-size", compact ? "10" : "14");
      totalLabel.setAttribute("text-anchor", "end");
      totalLabel.setAttribute("font-weight", "700");
      totalLabel.textContent = `Total ¥${total.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}T`;
      svg.append(totalLabel);
      legendItems.forEach(({ category, x, row }) => {
        const index = categories.indexOf(category);
        const legendY = renderHeight - 7 - (legendRows - 1 - row) * 18;
        const swatch = document.createElementNS(ns, "rect");
        swatch.setAttribute("x", String(x));
        swatch.setAttribute("y", String(legendY - 13));
        swatch.setAttribute("width", "14");
        swatch.setAttribute("height", "14");
        swatch.setAttribute("rx", "2");
        swatch.setAttribute("fill", colors[index]);
        svg.append(swatch);
        const label = document.createElementNS(ns, "text");
        label.setAttribute("x", String(x + 20));
        label.setAttribute("y", String(legendY));
        label.setAttribute("text-anchor", "start");
        label.setAttribute("font-size", String(legendFontSize));
        label.textContent = category;
        svg.append(label);
      });
      svg.setAttribute("role", "img");
      svg.setAttribute("aria-label", "Stacked area chart of Japan's gross external financial assets by category from 1996 to 2025, in trillions of yen, with the BPM6 transition marked at 2014.");
      return svg;
    },
  }],
  previewChart: "assets",
});
