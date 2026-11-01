import * as Plot from "@observablehq/plot";
import { defineChartPage } from "../../../charts/definition.ts";

interface AnnualArea { year: number; hectares: number }
interface Dataset { annual: AnnualArea[] }

export function squareKilometres(hectares: number): number {
  return hectares / 100;
}

function parseData(value: unknown): Dataset {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Expected clear-cutting data.");
  }
  const annual = (value as Record<string, unknown>).annual;
  if (!Array.isArray(annual) || !annual.length) throw new TypeError("Expected annual observations.");
  let previous: number | undefined;
  for (const item of annual) {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new TypeError("Invalid observation.");
    const row = item as Record<string, unknown>;
    if (typeof row.year !== "number" || !Number.isSafeInteger(row.year) || row.year < 1900 ||
        (previous !== undefined && row.year !== previous + 1) ||
        typeof row.hectares !== "number" || !Number.isSafeInteger(row.hectares) || row.hectares < 0) {
      throw new TypeError("Expected consecutive years and nonnegative integer hectares.");
    }
    previous = row.year;
  }
  return { annual: annual as AnnualArea[] };
}

export default defineChartPage<Dataset>({
  parseData,
  charts: [{
    id: "area",
    label: "Area notified",
    alt: "Annual area notified for clear-cutting in Finland, 2015–2025, in square kilometres. Notifications do not measure completed fellings.",
    render(data, { document, width, height, mode }) {
      const compact = width < 560;
      const headingLines = width < 896
        ? ["Total area of felling notifications", "to Finnish Forest Centre (km²)"]
        : ["Total area of felling notifications to Finnish Forest Centre (km²)"];
      const headingSize = compact ? 13 : mode === "preview" ? 20 : 16;
      const left = compact ? 48 : 66;
      const chartHeight = mode === "preview" ? height : Math.max(height, 400);
      const points = data.annual.map(row => ({
        year: String(row.year),
        km2: squareKilometres(row.hectares),
        tooltip: `${row.year}\n${squareKilometres(row.hectares).toLocaleString("en-US", { maximumFractionDigits: 2 })} km² notified for clear-cutting`,
      }));
      const svg = Plot.plot({
        document, width, height: chartHeight,
        marginTop: headingLines.length === 1 ? 48 : 70,
        marginLeft: left, marginRight: 18, marginBottom: 60,
        style: { fontSize: mode === "preview" ? "16px" : "12px" },
        x: {
          label: null,
          domain: points.map(row => row.year),
          ticks: compact ? points.filter((_, i) => i % 2 === 0 || i === points.length - 1).map(row => row.year) : undefined,
          tickSize: 0,
        },
        y: { label: null, zero: true, nice: true, grid: true, ticks: 5, tickFormat: ",.0f" },
        marks: [
          Plot.barY(points, {
            x: "year", y: "km2", fill: "#28775b", insetLeft: 1, insetRight: 1,
            title: "tooltip", tip: mode === "interactive",
          }),
          Plot.ruleY([0], { stroke: "#64748b" }),
        ],
      }) as unknown as SVGSVGElement;
      const text = (label: string, y: number, size: number, color = "#334155") => {
        const node = document.createElementNS("http://www.w3.org/2000/svg", "text");
        node.setAttribute("x", String(left));
        node.setAttribute("y", String(y));
        node.setAttribute("text-anchor", "start");
        node.setAttribute("font-size", String(size));
        node.setAttribute("fill", color);
        node.textContent = label;
        svg.append(node);
      };
      headingLines.forEach((line, index) => text(line, 22 + index * 24, headingSize));
      text("Source: Luke / Finnish Forest Centre", chartHeight - 10, mode === "preview" ? 14 : 10, "#64748b");
      svg.setAttribute("role", "img");
      svg.setAttribute("aria-label", `Area notified for clear-cutting in Finland, ${points[0]!.year}–${points.at(-1)!.year}, in square kilometres. Notifications, not completed fellings.`);
      return svg;
    },
  }],
});
