import * as Plot from "@observablehq/plot";
import { defineChartPage } from "../../../charts/definition.ts";

const categories = ["robbery", "electronicTheft", "aggravatedAssault", "rape", "homicide"] as const;
export interface Quarter {
  quarter: string;
  start: string;
  trips: number;
  crimes: Record<typeof categories[number], number>;
  countMethod: "table" | "embedded-chart-data" | "digitized-bars" | "printed-counts" | "monthly-reconstruction";
  crimeSource: string;
  crimeSection: string;
  crimeSources?: Array<{ url: string; section: string }>;
  months: Array<{ month: string; trips: number; url: string; file: string; sheet: string }>;
}
export interface Dataset { metadata: Record<string, unknown>; quarters: Quarter[] }

export function totalCrimes(row: Quarter): number {
  return categories.reduce((sum, key) => sum + row.crimes[key], 0);
}

function parseData(value: unknown): Dataset {
  if (!value || typeof value !== "object") throw new TypeError("Expected BART data.");
  const data = value as Partial<Dataset>;
  if (!data.metadata || !Array.isArray(data.quarters) || !data.quarters.length) {
    throw new TypeError("Missing metadata or quarters.");
  }
  let previous = "";
  for (const row of data.quarters) {
    if (!row || !/^FY\d{2} Q[1-4]$/.test(row.quarter) ||
      !/^\d{4}-\d{2}-01$/.test(row.start) || !Number.isFinite(Date.parse(row.start)) || row.start <= previous ||
      !Number.isSafeInteger(row.trips) || row.trips <= 0 || !row.crimes ||
      categories.some((key) => !Number.isSafeInteger(row.crimes[key]) || row.crimes[key] < 0) ||
      !["table", "embedded-chart-data", "digitized-bars", "printed-counts", "monthly-reconstruction"].includes(row.countMethod) ||
      typeof row.crimeSource !== "string" || !row.crimeSource.startsWith("https://www.bart.gov/") ||
      typeof row.crimeSection !== "string" || !Array.isArray(row.months) || row.months.length !== 3) {
      throw new TypeError("Invalid quarter or provenance.");
    }
    const start = new Date(`${row.start}T00:00:00Z`);
    if (row.crimeSources !== undefined && (!Array.isArray(row.crimeSources) || !row.crimeSources.length ||
      row.crimeSources.some((source) => !source || typeof source.url !== "string" ||
        !source.url.startsWith("https://www.bart.gov/") || typeof source.section !== "string" || !source.section))) {
      throw new TypeError("Invalid additional crime provenance.");
    }
    for (const [index, month] of row.months.entries()) {
      const expected = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + index, 1));
      if (month.month !== expected.toISOString().slice(0, 7) || !Number.isSafeInteger(month.trips) ||
        month.trips < 0 || typeof month.url !== "string" || !month.url.startsWith("https://www.bart.gov/") ||
        typeof month.file !== "string" || typeof month.sheet !== "string") {
        throw new TypeError("Invalid monthly ridership provenance.");
      }
    }
    if (row.months.reduce((sum, month) => sum + month.trips, 0) !== row.trips) {
      throw new TypeError("Monthly trips do not reconcile to the quarter.");
    }
    const fiscalYear = start.getUTCFullYear() + (start.getUTCMonth() >= 6 ? 1 : 0);
    const quarter = ((start.getUTCMonth() + 6) % 12) / 3 + 1;
    if (row.quarter !== `FY${String(fiscalYear).slice(-2)} Q${quarter}`) {
      throw new TypeError("Fiscal quarter does not match the calendar date.");
    }
    previous = row.start;
  }
  return data as Dataset;
}

const views = [
  { id: "rate", label: "Crimes per 1M trips", axis: "Crimes per 1M trips", color: "#b4482c" },
  { id: "crimes", label: "Crime counts", axis: "Crimes per quarter", color: "#b4482c" },
  { id: "trips", label: "Passenger trips", axis: "Passenger trips (millions)", color: "#2457a7" },
] as const;

const crimeSeriesBreaks = [
  { start: "2019-07-01", label: "Jul 2019: source change" },
  { start: "2025-01-01", label: "Jan 2025: UCR → NIBRS" },
] as const;
const crimeCaveat = " Crime totals combine robbery, aggravated assault, rape, homicide, and electronic theft. Dashed vertical lines and gaps mark the July 2019 source change and January 2025 reporting change. Earlier counts use monthly YTD snapshots subject to revisions; some later counts are digitized estimates.";

export default defineChartPage<Dataset>({
  parseData,
  charts: views.map((view) => ({
    id: view.id,
    label: view.label,
    alt: `Quarterly BART ${view.label.toLowerCase()}, July 2018 through June 2026.${view.id === "trips" ? " Total trips, not unique riders." : crimeCaveat}`,
    render(data, { document, width, height, mode }) {
      const points = data.quarters.map((row) => {
        const crimes = totalCrimes(row);
        const value = view.id === "rate" ? crimes / row.trips * 1e6 : view.id === "crimes" ? crimes : row.trips / 1e6;
        return { ...row, value, date: new Date(`${row.start}T00:00:00Z`),
          regime: crimeSeriesBreaks.filter((boundary) => row.start >= boundary.start).length,
          title: `${row.quarter} (${row.start.slice(0, 7)})\n${view.id !== "trips" && row.countMethod === "digitized-bars" ? "≈ " : ""}${value.toLocaleString("en-US", { maximumFractionDigits: view.id === "crimes" ? 0 : 2 })} ${view.axis.toLowerCase()}\n${crimes} crimes · ${row.trips.toLocaleString("en-US")} trips\nCounts: ${row.countMethod}${row.countMethod === "monthly-reconstruction" ? " (YTD snapshots; subject to revisions)" : ""}` };
      });
      const compact = width < 560;
      const crimeView = view.id !== "trips";
      const firstDate = points[0]!.date;
      const lastDate = points.at(-1)!.date;
      const middleDate = points[Math.floor(points.length / 2)]!.date;
      const monthYear = (date: Date) => date.toLocaleDateString("en-US", {
        month: "long", year: "numeric", timeZone: "UTC",
      });
      const lastMonth = new Date(Date.UTC(lastDate.getUTCFullYear(), lastDate.getUTCMonth() + 2, 1));
      const dateRange = `${monthYear(firstDate)}–${monthYear(lastMonth)}`;
      const svg = Plot.plot({
        document, width, height: mode === "preview" ? height : Math.max(height, 400),
        marginTop: 58, marginRight: 22, marginBottom: crimeView ? 73 : 55, marginLeft: compact ? 42 : 62,
        style: { fontSize: mode === "preview" ? "16px" : "12px" },
        x: { type: "utc", domain: [firstDate, lastDate],
          ticks: compact ? [firstDate, middleDate, lastDate] : 7,
          tickFormat: (date) => new Date(date).toLocaleDateString("en-US", { year: "numeric", timeZone: "UTC" }), label: null },
        y: { zero: true, nice: true, grid: true, ticks: compact ? 5 : 6, label: null },
        marks: [
          Plot.ruleY([0], { stroke: "#9ca3af" }),
          ...(crimeView ? crimeSeriesBreaks.map((boundary) => Plot.ruleX([new Date(boundary.start)], {
            stroke: "#64748b", strokeDasharray: "4,4",
          })) : []),
          // Do not connect across source-vintage or offense-reporting changes.
          Plot.lineY(points, { x: "date", y: "value", z: crimeView ? "regime" : undefined, stroke: view.color, strokeWidth: 2.5 }),
          Plot.dot(points, { x: "date", y: "value", fill: view.color, r: 3,
            title: "title", tip: mode === "interactive" }),
        ],
      }) as unknown as SVGSVGElement;
      const ns = "http://www.w3.org/2000/svg";
      const heading = document.createElementNS(ns, "text");
      heading.setAttribute("x", String(compact ? 42 : 62));
      heading.setAttribute("y", "20");
      heading.setAttribute("text-anchor", "start");
      heading.setAttribute("font-size", mode === "preview" ? "18" : "13");
      heading.textContent = view.axis;
      svg.append(heading);
      const subtitle = document.createElementNS(ns, "text");
      subtitle.setAttribute("x", String(compact ? 42 : 62));
      subtitle.setAttribute("y", "40");
      subtitle.setAttribute("text-anchor", "start");
      subtitle.setAttribute("font-size", mode === "preview" ? "15" : "11");
      subtitle.textContent = crimeView ? "Persons + electronic theft" : "Total trips, not unique riders";
      svg.append(subtitle);
      if (crimeView) {
        for (const [index, boundary] of crimeSeriesBreaks.entries()) {
          const note = document.createElementNS(ns, "text");
          note.setAttribute("x", String(width - 22));
          note.setAttribute("y", String((mode === "preview" ? height : Math.max(height, 400)) - 7 -
            (crimeSeriesBreaks.length - 1 - index) * 18));
          note.setAttribute("text-anchor", "end");
          note.setAttribute("font-size", mode === "preview" ? "15" : "11");
          note.setAttribute("fill", "#475569");
          note.textContent = boundary.label;
          svg.append(note);
        }
      }
      svg.setAttribute("role", "img");
      svg.setAttribute("aria-label", `BART ${view.label.toLowerCase()} by quarter, ${dateRange}.${crimeView ? crimeCaveat : " Trips are independently sourced from monthly origin-destination totals."}`);
      return svg;
    },
  })),
  previewChart: "rate",
});
