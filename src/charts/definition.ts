/** Shared contract implemented by every standardized chart page. */
export interface ChartRenderOptions {
  document: Document;
  width: number;
  height: number;
  mode: "interactive" | "static" | "preview";
}

export interface ChartDefinition<Data = unknown> {
  parseData(value: unknown): Data;
  charts: Array<{
    id: string;
    label: string;
    alt: string;
    render(data: Data, options: ChartRenderOptions): SVGSVGElement;
  }>;
  /** Chart id to render for the static preview and social-card image. */
  previewChart?: string;
}

export function defineChartPage<Data>(definition: ChartDefinition<Data>): ChartDefinition<Data> {
  if (typeof definition.parseData !== "function" || !Array.isArray(definition.charts) || definition.charts.length === 0) {
    throw new Error("A chart page must provide parseData and at least one chart.");
  }
  const ids = new Set<string>();
  for (const chart of definition.charts) {
    if (!chart.id || !chart.label || !chart.alt || typeof chart.render !== "function" || ids.has(chart.id)) {
      throw new Error("Each chart must have a unique id, label, alt text, and render function.");
    }
    ids.add(chart.id);
  }
  if (definition.previewChart && !ids.has(definition.previewChart)) {
    throw new Error(`Unknown previewChart id: ${definition.previewChart}`);
  }
  return definition;
}
