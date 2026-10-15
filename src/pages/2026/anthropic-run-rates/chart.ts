import * as Plot from "@observablehq/plot";
import { defineChartPage } from "../../../charts/definition.ts";
import { estimateQuarter } from "./estimates.ts";

interface Point {
  date: string;
  value: number;
  label: string;
  dateText: string;
  source: string;
  url: string;
}

interface RevenueData {
  runRate: Point[];
  quarterlyRevenue: Point[];
}

function parseSeries(value: unknown, name: keyof RevenueData): Point[] {
  if (!Array.isArray(value) || value.length === 0) throw new TypeError(`Expected nonempty ${name} data.`);
  return value.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new TypeError(`Invalid ${name} point ${index}.`);
    const row = item as Record<string, unknown>;
    if (typeof row.date !== "string" || !Number.isFinite(Date.parse(row.date)) ||
      typeof row.value !== "number" || !Number.isFinite(row.value) || row.value < 0 ||
      typeof row.label !== "string" || typeof row.dateText !== "string" ||
      typeof row.source !== "string" || typeof row.url !== "string") throw new TypeError(`Invalid ${name} point ${index}.`);
    return row as unknown as Point;
  });
}

function parseData(value: unknown): RevenueData {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("Expected revenue data object.");
  const data = value as Record<string, unknown>;
  return {
    runRate: parseSeries(data.runRate, "runRate"),
    quarterlyRevenue: parseSeries(data.quarterlyRevenue, "quarterlyRevenue"),
  };
}

export default defineChartPage<RevenueData>({
  parseData,
  charts: [{
    id: "quarterly-revenue",
    label: "Quarterly Revenue",
    alt: "Reported Anthropic quarterly revenue in 2026: approximately $4.8 billion in Q1, $11.5 billion in Q2, and $16.8 billion in Q3. Not annualized.",
    render(data, { document, width, height, mode }) {
      const points = data.quarterlyRevenue;
      const compact = width < 560;
      const svg = Plot.plot({
        document, width, height: mode !== "preview" ? Math.max(height, 400) : height,
        marginTop: compact ? 42 : 52, marginRight: compact ? 22 : 35,
        marginBottom: 62, marginLeft: compact ? 48 : 62,
        x: { domain: points.map((d) => d.dateText), label: null, padding: 0.35 },
        y: { domain: [0, 20], ticks: 5, label: null, grid: true },
        marks: [
          Plot.ruleY([0]),
          Plot.barY(points, {
            x: "dateText", y: "value", fill: "#2457a7",
            tip: mode === "interactive",
            title: (d: Point) => `${d.dateText}\n${d.label}\n${d.source}`,
          }),
          Plot.text(points, {
            x: "dateText", y: "value", text: "label", dy: -13,
            fill: "#183e78", fontWeight: 650,
            fontSize: mode === "preview" ? 16 : compact ? 12 : 14,
          }),
        ],
      }) as unknown as SVGSVGElement;
      svg.setAttribute("role", "img");
      svg.setAttribute("aria-label", "Reported Anthropic quarterly revenue in 2026: approximately $4.8 billion in Q1, $11.5 billion in Q2, and $16.8 billion in Q3. Not annualized.");
      return svg;
    },
  }, {
    id: "run-rate",
    label: "Run Rate",
    alt: "Reported Anthropic annual run-rate milestones, in billions of dollars, from the end of 2025 through July 2026.",
    render(data, { document, width, height, mode }) {
      const points = data.runRate.map((d) => ({ ...d, dateValue: new Date(`${d.date}T00:00:00Z`) }));
      const compact = width < 560;
      const renderHeight = mode !== "preview" ? Math.max(height, 400) : height;
      const svg = Plot.plot({
        document, width, height: renderHeight,
        marginTop: compact ? 42 : 52, marginRight: compact ? 22 : 35,
        marginBottom: 62, marginLeft: compact ? 48 : 62,
        x: { type: "utc", domain: [new Date("2025-12-31T00:00:00Z"), new Date("2026-09-30T00:00:00Z")],
          ticks: ["2025-12-31", "2026-03-31", "2026-06-30", "2026-09-30"]
            .map((date) => new Date(`${date}T00:00:00Z`)),
          tickFormat: (d) => new Date(d).toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric" }), label: null },
        y: { domain: [0, 70], ticks: 8, label: null, grid: true },
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
  }, {
    id: "comparison",
    label: "Comparison",
    alt: "Quarterly revenue compared with estimates from the area under the annual run-rate curve, in billions of dollars. Q3 includes linear extrapolation beyond July 31.",
    render(data, { document, width, height, mode }) {
      const compact = width < 560;
      const renderHeight = mode !== "preview" ? Math.max(height, 400) : height;
      const points = data.quarterlyRevenue.flatMap((quarter, index) => {
        const estimate = estimateQuarter(data.runRate, quarter.date);
        return [
          { x: index - 0.2, x1: index - 0.38, x2: index - 0.02, value: quarter.value,
            labelValue: compact ? Math.max(quarter.value, estimate.value) : quarter.value,
            kind: "Reported", label: quarter.label, projected: false,
            title: `${quarter.dateText}\nReported: ${quarter.label}\n${quarter.source}` },
          { x: index + 0.2, x1: index + 0.02, x2: index + 0.38, value: estimate.value,
            labelValue: compact ? Math.max(quarter.value, estimate.value) : estimate.value,
            kind: "Run-rate estimate", label: `~$${estimate.value.toFixed(1)}B${estimate.extrapolated ? "*" : ""}`,
            projected: estimate.extrapolated,
            title: `${quarter.dateText}\nRun-rate area estimate: $${estimate.value.toFixed(2)}B\n${estimate.extrapolated
              ? "Includes linear extrapolation using the last two milestones."
              : "Piecewise-linear interpolation between milestones."}` },
        ];
      });
      const svg = Plot.plot({
        document, width, height: renderHeight,
        marginTop: 55, marginRight: compact ? 22 : 35,
        marginBottom: 85, marginLeft: compact ? 48 : 62,
        x: { domain: [-0.5, data.quarterlyRevenue.length - 0.5],
          ticks: data.quarterlyRevenue.map((_, index) => index),
          tickFormat: (index) => data.quarterlyRevenue[Number(index)]!.dateText, label: null },
        y: { domain: [0, Math.ceil(Math.max(...points.map((point) => point.value)) / 5) * 5],
          ticks: 5, label: null, grid: true },
        color: { domain: ["Reported", "Run-rate estimate"], range: ["#2457a7", "#b65e16"] },
        marks: [
          Plot.ruleY([0]),
          Plot.rect(points.filter((point) => !point.projected), {
            x1: "x1", x2: "x2", y1: 0, y2: "value", fill: "kind", stroke: "kind",
            tip: mode === "interactive", title: "title" }),
          Plot.rect(points.filter((point) => point.projected), {
            x1: "x1", x2: "x2", y1: 0, y2: "value", fill: "kind", fillOpacity: 0.65,
            stroke: "kind", strokeDasharray: "4,3", tip: mode === "interactive", title: "title" }),
          ...["Reported", "Run-rate estimate"].map((kind) => Plot.text(
            points.filter((point) => point.kind === kind), { x: "x", y: "labelValue", text: "label",
            dy: compact && kind === "Reported" ? -27 : -12,
            fontSize: mode === "preview" ? 16 : compact ? 11 : 14, fontWeight: 650,
            fill: "kind", stroke: "white", strokeWidth: 3, paintOrder: "stroke" })),
        ],
      }) as unknown as SVGSVGElement;
      // Keep the legend and caveat in the SVG so they survive standalone export.
      const text = (label: string, x: number, y: number, size: number, fill = "#172323") => {
        const node = document.createElementNS("http://www.w3.org/2000/svg", "text");
        node.setAttribute("x", String(x));
        node.setAttribute("y", String(y));
        node.setAttribute("font-size", String(size));
        node.setAttribute("text-anchor", "start");
        node.setAttribute("fill", fill);
        node.textContent = label;
        svg.append(node);
      };
      const left = compact ? 48 : 62;
      text("■ Reported", left, 23, compact ? 11 : 14, "#2457a7");
      text("■ Run-rate estimate", left + (compact ? 87 : 120), 23, compact ? 11 : 14, "#b65e16");
      text("* Q3 extends the May–July trend", left, renderHeight - 30, compact ? 10 : 12);
      text("beyond July 31. All values in $B.", left, renderHeight - 14, compact ? 10 : 12);
      svg.setAttribute("role", "img");
      svg.setAttribute("aria-label", "Quarterly revenue compared with estimates from the area under the annual run-rate curve, in billions of dollars. Q3 includes linear extrapolation beyond July 31.");
      return svg;
    },
  }],
  previewChart: "run-rate",
});
