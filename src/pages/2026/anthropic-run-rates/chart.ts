import * as Plot from "@observablehq/plot";
import { defineChartPage } from "../../../charts/definition.ts";

interface Point {
  date: string;
  value: number;
  series: string;
  label: string;
  dateText: string;
  source: string;
  url: string;
}

function parseData(value: unknown): Point[] {
  if (!Array.isArray(value) || value.length === 0) throw new TypeError("Expected run-rate data.");
  return value.map((item, index) => {
    if (!item || typeof item !== "object") throw new TypeError(`Invalid point ${index}.`);
    const row = item as Record<string, unknown>;
    if (typeof row.date !== "string" || !Number.isFinite(Date.parse(row.date)) ||
      typeof row.value !== "number" || !Number.isFinite(row.value) ||
      typeof row.label !== "string" || typeof row.dateText !== "string" ||
      typeof row.source !== "string" || typeof row.url !== "string" ||
      row.series !== "runrate") throw new TypeError(`Invalid point ${index}.`);
    return row as unknown as Point;
  });
}

export default defineChartPage<Point[]>({
  parseData,
  charts: [{
    id: "run-rate",
    label: "Anthropic annual revenue run rate",
    alt: "Reported Anthropic annual run-rate milestones, in billions of dollars, from the end of 2025 through July 2026.",
    render(data, { document, width, height, mode }) {
      const points = data.map((d) => ({ ...d, dateValue: new Date(`${d.date}T00:00:00Z`) }));
      const compact = width < 560;
      const renderHeight = mode !== "preview" ? Math.max(height, 400) : height;
      const svg = Plot.plot({
        document, width, height: renderHeight,
        marginTop: compact ? 42 : 52, marginRight: compact ? 22 : 35,
        marginBottom: 62, marginLeft: compact ? 48 : 62,
        x: { type: "utc", domain: [new Date("2025-12-31T00:00:00Z"), new Date("2026-07-31T00:00:00Z")],
          ticks: compact ? [new Date("2025-12-31T00:00:00Z"), new Date("2026-04-01T00:00:00Z"), new Date("2026-07-31T00:00:00Z")] : 5,
          tickFormat: (d) => new Date(d).toLocaleDateString("en-US", { timeZone: "UTC", month: "short", year: "2-digit" }), label: null },
        y: { domain: [0, 70], ticks: 8, label: "Annual run rate ($B)", grid: true },
        marks: [
          Plot.line(points, { x: "dateValue", y: "value", stroke: "#2457a7", strokeWidth: 3 }),
          Plot.dot(points, { x: "dateValue", y: "value", fill: "#2457a7", stroke: "white", strokeWidth: 2, r: 5,
            tip: mode === "interactive", title: (d: Point) => `${d.dateText}\n${d.label}\n${d.source}` }),
          Plot.text([points[0]!], {
            x: "dateValue", y: "value", text: "label", dy: -13, textAnchor: "start",
            fill: "#183e78", stroke: "white", strokeWidth: 4, paintOrder: "stroke",
            fontWeight: 650, fontSize: mode === "preview" ? 16 : compact ? 12 : 14,
          }),
          Plot.text([points.at(-1)!], {
            x: "dateValue", y: "value", text: "label", dy: -13, textAnchor: "end",
            fill: "#183e78", stroke: "white", strokeWidth: 4, paintOrder: "stroke",
            fontWeight: 650, fontSize: mode === "preview" ? 16 : compact ? 12 : 14,
          }),
          Plot.text(points.filter((d) => d.date === "2026-02-12"), {
            x: "dateValue", y: "value", text: "label", dy: -13, textAnchor: "end",
            fill: "#183e78", stroke: "white", strokeWidth: 4, paintOrder: "stroke",
            fontWeight: 650, fontSize: mode === "preview" ? 16 : compact ? 12 : 14,
          }),
          Plot.text(points.filter((d) => d.date === "2026-02-28"), {
            x: "dateValue", y: "value", text: "label", dy: -13, textAnchor: "start",
            fill: "#183e78", stroke: "white", strokeWidth: 4, paintOrder: "stroke",
            fontWeight: 650, fontSize: mode === "preview" ? 16 : compact ? 12 : 14,
          }),
          Plot.text(points.filter((d) => d.date !== points[0]!.date && d.date !== points.at(-1)!.date &&
            d.date !== "2026-02-12" && d.date !== "2026-02-28"), {
            x: "dateValue", y: "value", text: "label", dy: -13, textAnchor: "middle",
            fill: "#183e78", stroke: "white", strokeWidth: 4, paintOrder: "stroke",
            fontWeight: 650, fontSize: mode === "preview" ? 16 : compact ? 12 : 14,
          }),
        ],
      }) as unknown as SVGSVGElement;
      const labelAnchors = new Map<string, "start" | "middle" | "end">([
        [points[0]!.label, "start"],
        [points.at(-1)!.label, "end"],
        ["$14B", "end"],
        ["~$19B", "start"],
        ...points.slice(1, -1)
          .filter((point) => point.date !== "2026-02-12" && point.date !== "2026-02-28")
          .map((point) => [point.label, "middle"] as const),
      ]);
      for (const label of svg.querySelectorAll("text")) {
        const anchor = labelAnchors.get(label.textContent ?? "");
        if (anchor) label.setAttribute("text-anchor", anchor);
      }
      svg.setAttribute("role", "img");
      svg.setAttribute("aria-label", "Reported Anthropic annual run-rate milestones, in billions of dollars, from the end of 2025 through July 2026.");
      return svg;
    },
  }],
  previewChart: "run-rate",
});
