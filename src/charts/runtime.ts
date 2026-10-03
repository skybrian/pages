import type { ChartDefinition } from "./definition.js";

export interface ChartPageOptions {
  dataUrl?: string;
  root?: HTMLElement;
  controls?: HTMLElement;
  copyButton?: HTMLButtonElement;
  copyStatus?: HTMLElement;
}

export async function copySvgToClipboard(
  svg: SVGSVGElement,
  { document = svg.ownerDocument, clipboard = globalThis.navigator?.clipboard }: {
    document?: Document;
    clipboard?: Pick<Clipboard, "writeText">;
  } = {},
): Promise<void> {
  const copy = svg.cloneNode(true) as SVGSVGElement;
  copy.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  const markup = new (document.defaultView?.XMLSerializer ?? XMLSerializer)().serializeToString(copy);
  try {
    if (clipboard?.writeText) {
      await clipboard.writeText(markup);
      return;
    }
  } catch {
    // Clipboard APIs can be present but unavailable outside a secure context.
  }
  const textarea = document.createElement("textarea");
  textarea.value = markup;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.append(textarea);
  const previousFocus = document.activeElement as HTMLElement | null;
  try {
    textarea.select();
    if (!document.execCommand?.("copy")) throw new Error("Clipboard access is unavailable.");
  } finally {
    textarea.remove();
    previousFocus?.focus?.();
  }
}

/** Browser entry point: owns loading, navigation, responsive rendering, and export. */
export function mountChartPage<Data>(
  definition: ChartDefinition<Data>,
  { dataUrl = "./data.json", root = document.querySelector<HTMLElement>("[data-chart-root]") ?? undefined,
    controls = document.querySelector<HTMLElement>("[data-chart-tabs]") ?? undefined,
    copyButton = document.querySelector<HTMLButtonElement>("[data-copy-svg]") ?? undefined,
    copyStatus = document.querySelector<HTMLElement>("[data-copy-status]") ?? undefined }: ChartPageOptions = {},
): void {
  if (!root) return;
  let dataPromise: Promise<Data> | undefined;
  const fragmentId = (): string => {
    try { return decodeURIComponent(location.hash.slice(1)); } catch { return ""; }
  };
  let active = definition.charts.find((chart) => chart.id === fragmentId()) ?? definition.charts[0]!;
  let resizeTimer = 0;

  const loadData = (): Promise<Data> => {
    dataPromise ??= fetch(dataUrl).then((response) => {
      if (!response.ok) throw new Error(`Could not load chart data (HTTP ${response.status}).`);
      return response.json().then((value: unknown) => definition.parseData(value));
    });
    return dataPromise;
  };
  const render = async (): Promise<void> => {
    root.setAttribute("aria-busy", "true");
    try {
      const data = await loadData();
      const width = Math.max(280, Math.floor(root.clientWidth || 960));
      const svg = active.render(data, {
        document: root.ownerDocument,
        width,
        height: Math.max(400, Math.round(width * 0.56)),
        mode: "interactive",
      });
      svg.setAttribute("role", "img");
      svg.setAttribute("aria-label", active.alt);
      svg.setAttribute("focusable", "false");
      root.replaceChildren(svg);
      root.setAttribute("aria-busy", "false");
      if (copyButton) copyButton.disabled = false;
    } catch (error) {
      root.setAttribute("aria-busy", "false");
      root.textContent = `Chart unavailable: ${error instanceof Error ? error.message : "Unable to load chart."}`;
      if (copyButton) copyButton.disabled = true;
    }
  };

  const choose = (chart: (typeof definition.charts)[number], focus = false) => {
    active = chart;
    history.replaceState(null, "", `#${encodeURIComponent(chart.id)}`);
    for (const button of controls?.querySelectorAll<HTMLButtonElement>("[role=tab]") ?? []) {
      const selected = button.dataset.chartId === chart.id;
      button.setAttribute("aria-selected", String(selected));
      button.tabIndex = selected ? 0 : -1;
      if (selected) {
        root.setAttribute("aria-labelledby", button.id);
        if (focus) button.focus();
      }
    }
    void render();
  };

  if (controls) {
    controls.hidden = definition.charts.length < 2;
    if (definition.charts.length < 2) {
      controls.replaceChildren();
      root.setAttribute("role", "region");
      root.removeAttribute("aria-labelledby");
    } else {
      if (!root.id) root.id = "chart-panel";
      root.setAttribute("role", "tabpanel");
      root.tabIndex = 0;
      controls.replaceChildren(...definition.charts.map((chart, index) => {
        const button = controls.ownerDocument.createElement("button");
        button.type = "button";
        button.setAttribute("role", "tab");
        button.dataset.chartId = chart.id;
        button.id = `chart-tab-${chart.id}`;
        button.setAttribute("aria-controls", root.id);
        button.textContent = chart.label;
        button.setAttribute("aria-selected", String(chart.id === active.id));
        button.tabIndex = chart.id === active.id ? 0 : -1;
        if (chart.id === active.id) root.setAttribute("aria-labelledby", button.id);
        button.addEventListener("click", () => choose(chart));
        button.addEventListener("keydown", (event) => {
          if (event.key !== "ArrowLeft" && event.key !== "ArrowRight" && event.key !== "Home" && event.key !== "End") return;
          event.preventDefault();
          const next = event.key === "Home" ? 0 : event.key === "End" ? definition.charts.length - 1 :
            (index + (event.key === "ArrowRight" ? 1 : -1) + definition.charts.length) % definition.charts.length;
          choose(definition.charts[next]!, true);
        });
        return button;
      }));
    }
  }
  if (copyButton) {
    copyButton.disabled = true;
    copyButton.addEventListener("click", async () => {
      const svg = root.querySelector("svg");
      if (!svg) return;
      copyButton.disabled = true;
      try {
        await copySvgToClipboard(svg);
        if (copyStatus) copyStatus.textContent = "SVG copied to clipboard.";
      } catch {
        if (copyStatus) copyStatus.textContent = "Copy failed. Select and copy the chart SVG manually.";
      } finally {
        copyButton.disabled = false;
      }
    });
  }
  window.addEventListener("hashchange", () => {
    const chart = definition.charts.find((item) => item.id === fragmentId());
    if (chart && chart.id !== active.id) choose(chart);
  });
  window.addEventListener("resize", () => {
    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => void render(), 120);
  });
  void render();
}
