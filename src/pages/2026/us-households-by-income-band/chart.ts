import * as Plot from "@observablehq/plot";
import { defineChartPage } from "../../../charts/definition.ts";

interface IncomeRow {
  year: number;
  low: number;
  middle: number;
  high: number;
  total: number;
  median_income: number;
}

type Band = "Low-income" | "Middle-income" | "High-income";
interface BandRow {
  year: number;
  band: Band;
  value: number;
}

const bands: Array<{ key: keyof Pick<IncomeRow, "low" | "middle" | "high">; band: Band; label: string; fill: string }> = [
  { key: "low", band: "Low-income", label: "Under $35k", fill: "#34b7f1" },
  { key: "middle", band: "Middle-income", label: "$35k–$99,999", fill: "#0095d9" },
  { key: "high", band: "High-income", label: "$100k+", fill: "#005b87" },
];

function parseData(value: unknown): IncomeRow[] {
  if (!Array.isArray(value) || value.length === 0) throw new TypeError("Expected a non-empty array of household data.");
  return value.map((row, index) => {
    if (typeof row !== "object" || row === null) throw new TypeError(`Invalid row ${index}.`);
    const candidate = row as Record<string, unknown>;
    for (const key of ["year", "low", "middle", "high", "total", "median_income"]) {
      if (typeof candidate[key] !== "number" || !Number.isFinite(candidate[key])) {
        throw new TypeError(`Invalid ${key} in row ${index}.`);
      }
    }
    if ((candidate.total as number) <= 0) throw new TypeError(`Total households must be positive in row ${index}.`);
    return candidate as unknown as IncomeRow;
  });
}

function toBandRows(data: IncomeRow[], shares: boolean): BandRow[] {
  return data.flatMap((row) => bands.map(({ key, band }) => ({
    year: row.year,
    band,
    value: shares ? row[key] / row.total * 100 : row[key],
  })));
}

function renderStackedArea(
  data: IncomeRow[],
  { document, width, height, mode }: { document: Document; width: number; height: number; mode: "interactive" | "preview" },
  shares: boolean,
): SVGSVGElement {
  const values = toBandRows(data, shares);
  const latest = data.at(-1);
  const labelYear = data[Math.floor(data.length / 2)]!;
  const compact = width < 600;
  const chartHeight = compact ? Math.max(height, 400) : height;
  let cumulative = 0;
  const labelMarks = bands.map(({ key, band }) => {
    const amount = shares ? labelYear[key] / labelYear.total * 100 : labelYear[key];
    const mark = { year: compact ? labelYear.year : labelYear.year + 1, value: cumulative + amount / 2, label: band };
    cumulative += amount;
    return mark;
  });
  const marks = [
    Plot.areaY(values, Plot.stackY({
      z: "band",
      order: bands.map(({ band }) => band),
    }, {
      x: "year",
      y: "value",
      fill: "band",
      stroke: "#08394f",
      strokeWidth: 1.2,
      curve: "basis",
    })),
    ...(mode === "interactive" ? [Plot.dot(values, Plot.pointerX({
      x: "year",
      y: "value",
      r: 0,
      fill: "transparent",
      tip: true,
      title: (d: BandRow) => `${d.year}\n${d.band}: ${d.value.toFixed(1)}${shares ? "%" : "M households"}`,
    }))] : []),
    Plot.ruleY(shares ? [0, 20, 40, 60, 80, 100] : [0, 20, 40, 60, 80, 100, 120, 140], { stroke: "#d7d7d7" }),
    ...(compact ? [] : [Plot.text(
      labelMarks,
      { x: "year", y: "value", text: "label", fill: "white", fontSize: 13, fontWeight: 700, textAnchor: "start" },
    )]),
    Plot.text(
      latest ? [{ year: 2023, value: shares ? 3 : 5, label: `${latest.year}: ${shares ? "100%" : `${latest.total.toFixed(1)}M total`}` }] : [],
      { x: "year", y: "value", text: "label", textAnchor: "end", fontWeight: 700 },
    ),
  ];
  const svg = Plot.plot({
    document,
    width,
    height: chartHeight,
    marginLeft: compact ? 48 : 76,
    marginRight: compact ? 24 : 70,
    marginTop: compact ? 90 : 30,
    marginBottom: 44,
    x: { domain: [1967, 2024], ticks: compact ? [1970, 1990, 2010, 2024] : [1970, 1980, 1990, 2000, 2010, 2020, 2024], tickFormat: (d) => `${d}`, label: null },
    y: {
      domain: shares ? [0, 100] : [0, 142],
      ticks: shares ? 5 : 7,
      tickFormat: shares ? (d) => `${d}%` : (d) => `${d}M`,
      label: shares ? "Percent of households" : "Millions of households",
      grid: false,
    },
    color: { domain: bands.map(({ band }) => band), range: bands.map(({ fill }) => fill), legend: false },
    marks,
  }) as SVGSVGElement;
  svg.style.fontSize = mode === "preview" ? "16px" : "10px";
  if (compact) {
    const ns = "http://www.w3.org/2000/svg";
    const legend = document.createElementNS(ns, "g");
    legend.setAttribute("role", "group");
    legend.setAttribute("aria-label", "Income bands");
    legend.setAttribute("font-size", "10");
    legend.setAttribute("font-family", "system-ui, sans-serif");
    for (const [index, { label, fill }] of bands.entries()) {
      const y = 30 + index * 18;
      const swatch = document.createElementNS(ns, "rect");
      swatch.setAttribute("x", "48");
      swatch.setAttribute("y", String(y - 9));
      swatch.setAttribute("width", "10");
      swatch.setAttribute("height", "10");
      swatch.setAttribute("fill", fill);
      legend.append(swatch);
      const text = document.createElementNS(ns, "text");
      text.setAttribute("x", "66");
      text.setAttribute("y", String(y));
      text.setAttribute("text-anchor", "start");
      text.setAttribute("fill", "#111");
      text.textContent = label;
      legend.append(text);
    }
    svg.append(legend);
  }
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", shares
    ? "Stacked area chart of household shares by income band from 1967 to 2024."
    : "Stacked area chart of U.S. households by income band, in millions, from 1967 to 2024.");
  return svg;
}

export default defineChartPage<IncomeRow[]>({
  parseData,
  charts: [
    {
      id: "counts",
      label: "Household counts",
      alt: "Stacked area chart of U.S. households by income band, in millions, from 1967 to 2024.",
      render: (data, options) => renderStackedArea(data, options, false),
    },
    {
      id: "shares",
      label: "Household shares",
      alt: "Stacked area chart of the share of U.S. households by income band from 1967 to 2024.",
      render: (data, options) => renderStackedArea(data, options, true),
    },
  ],
  previewChart: "counts",
});
