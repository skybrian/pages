import * as Plot from "@observablehq/plot";
import { defineChartPage } from "../../../charts/definition.ts";

interface FleetPoint {
  date: string;
  vehicles: number;
  qualifier: "about" | "more than";
  source: string;
  url: string;
}
interface FleetData { fleet: FleetPoint[] }

function parseData(value: unknown): FleetData {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("Expected fleet data object.");
  const fleet = (value as Record<string, unknown>).fleet;
  if (!Array.isArray(fleet) || fleet.length === 0) throw new TypeError("Expected nonempty fleet observations.");
  let previous = "";
  for (const item of fleet) {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new TypeError("Invalid observation.");
    const point = item as Record<string, unknown>;
    if (typeof point.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(point.date) ||
        !Number.isFinite(Date.parse(point.date)) || point.date <= previous ||
        !Number.isSafeInteger(point.vehicles) || (point.vehicles as number) <= 0 ||
        (point.qualifier !== "about" && point.qualifier !== "more than") ||
        typeof point.source !== "string" || !point.source ||
        typeof point.url !== "string" || !point.url.startsWith("https://")) {
      throw new TypeError("Invalid or unordered fleet observation.");
    }
    previous = point.date;
  }
  return { fleet: fleet as FleetPoint[] };
}

export default defineChartPage<FleetData>({
  parseData,
  charts: [{
    id: "fleet",
    label: "Fleet size",
    alt: "Reported U.S. Waymo robotaxi fleet size grew from about 700 in August 2024 to more than 4,000 in September 2026. Intermediate values are 1,500-plus in May 2025 and 2,500-plus in November 2025 and February 2026.",
    render(data, { document, width, height, mode }) {
      const compact = width < 560;
      const points = data.fleet.map((d) => ({
        ...d,
        when: new Date(d.date + "T00:00:00Z"),
        tooltip: `${d.date}\n${d.qualifier === "about" ? "About" : "More than"} ${d.vehicles.toLocaleString("en-US")} vehicles\n${d.source}`,
      }));
      const svg = Plot.plot({
        document, width, height: mode === "preview" ? height : Math.max(height, 400),
        marginTop: 55, marginBottom: 60, marginLeft: compact ? 54 : 70,
        marginRight: compact ? 18 : 36,
        x: { type: "utc", label: null, ticks: 4, tickFormat: "%b %Y" },
        y: { domain: [0, 4600], grid: true, label: "Vehicles (reported floor / approximate)", ticks: 5 },
        marks: [
          Plot.ruleY([0]),
          Plot.line(points, { x: "when", y: "vehicles", stroke: "#2457a7", strokeWidth: 2.5 }),
          Plot.dot(points, {
            x: "when", y: "vehicles", r: 5, fill: "#2457a7", stroke: "white", strokeWidth: 1.5,
            tip: mode === "interactive", title: "tooltip",
          }),
          Plot.text(points, {
            x: "when", y: "vehicles",
            text: (d: (typeof points)[number]) => (d.qualifier === "about" ? "~" : ">") + d.vehicles.toLocaleString("en-US"),
            dy: -13, fontSize: mode === "preview" ? 16 : compact ? 11 : 13,
            fill: "#183e78", stroke: "white", strokeWidth: 3, paintOrder: "stroke",
          }),
        ],
      }) as unknown as SVGSVGElement;
      svg.setAttribute("role", "img");
      svg.setAttribute("aria-label", "Reported nationwide Waymo robotaxi fleet counts from August 2024 to September 2026. Values are approximate or lower bounds; straight lines are visual guides, not monthly measurements.");
      return svg;
    },
  }],
});
