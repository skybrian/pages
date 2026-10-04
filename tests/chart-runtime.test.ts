import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { JSDOM } from "jsdom";
import { copySvgToClipboard, mountChartPage } from "../src/charts/runtime.ts";

const wait = () => new Promise((resolve) => setTimeout(resolve, 0));

function setGlobals(dom: JSDOM): () => void {
  const values: Record<string, unknown> = {
    document: dom.window.document,
    window: dom.window,
    location: dom.window.location,
    history: dom.window.history,
    navigator: dom.window.navigator,
    fetch: globalThis.fetch,
  };
  const previous = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries(values)) {
    previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  return () => {
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  };
}

describe("chart runtime", () => {
  it("loads data once, honors fragments, supports keyboard tabs, labels the panel, and copies the active SVG", async () => {
    const dom = new JSDOM(`<!doctype html><div data-chart-tabs></div>
      <div data-chart-root></div><button data-copy-svg></button><span data-copy-status></span>`,
    { url: "https://example.test/chart/#second" });
    const restore = setGlobals(dom);
    let fetches = 0;
    let copied = "";
    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      value: async () => {
        fetches++;
        return { ok: true, json: async () => ({ value: 42 }) };
      },
    });
    Object.defineProperty(globalThis.navigator, "clipboard", {
      configurable: true,
      value: { writeText: async (text: string) => { copied = text; } },
    });
    try {
      const document = dom.window.document;
      const controls = document.querySelector<HTMLElement>("[data-chart-tabs]")!;
      const root = document.querySelector<HTMLElement>("[data-chart-root]")!;
      Object.defineProperty(root, "clientWidth", { configurable: true, value: 350 });
      const copyButton = document.querySelector<HTMLButtonElement>("[data-copy-svg]")!;
      const copyStatus = document.querySelector<HTMLElement>("[data-copy-status]")!;
      let renderedSize = { width: 0, height: 0 };
      let renderCount = 0;
      const makeChart = (id: string) => ({
        id,
        label: id,
        alt: `${id} chart`,
        render(data: { value: number }, { document: doc, width, height }: { document: Document; width: number; height: number }) {
          renderCount++;
          renderedSize = { width, height };
          const svg = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
          svg.setAttribute("viewBox", "0 0 100 100");
          const text = doc.createElementNS("http://www.w3.org/2000/svg", "text");
          text.textContent = `${id}:${data.value}`;
          svg.append(text);
          return svg;
        },
      });
      mountChartPage({
        parseData: (data: unknown) => data as { value: number },
        charts: [makeChart("first"), makeChart("second")],
      }, { root, controls, copyButton, copyStatus });
      await wait();

      assert.equal(root.querySelector("text")?.textContent, "second:42");
      assert.equal(root.querySelector("svg")?.getAttribute("aria-label"), "second chart");
      assert.equal(root.getAttribute("role"), "tabpanel");
      assert.equal(root.getAttribute("aria-labelledby"), "chart-tab-second");
      assert.equal(controls.hidden, false);
      assert.deepEqual(renderedSize, { width: 320, height: 400 });
      assert.equal(fetches, 1);

      const beforeResize = renderCount;
      dom.window.dispatchEvent(new dom.window.Event("resize"));
      dom.window.dispatchEvent(new dom.window.Event("resize"));
      await new Promise((resolve) => setTimeout(resolve, 150));
      assert.equal(renderCount, beforeResize + 1);
      assert.equal(fetches, 1);

      const secondTab = controls.querySelector<HTMLButtonElement>("#chart-tab-second")!;
      secondTab.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
      await wait();
      assert.equal(document.activeElement?.id, "chart-tab-first");
      assert.equal(root.querySelector("text")?.textContent, "first:42");
      assert.equal(fetches, 1);

      copyButton.click();
      await wait();
      assert.match(copied, /<svg[^>]+xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
      assert.match(copied, /first:42/);
      assert.equal(copyStatus.textContent, "SVG copied to clipboard.");

      dom.window.history.replaceState(null, "", "/chart/#%");
      dom.window.dispatchEvent(new dom.window.HashChangeEvent("hashchange"));
      assert.equal(root.querySelector("text")?.textContent, "first:42");
    } finally {
      restore();
      dom.window.close();
    }
  });

  it("hides the tablist for a single chart and reports clipboard fallback failure", async () => {
    const dom = new JSDOM(`<div data-chart-tabs></div><div data-chart-root></div>`, { url: "https://example.test/" });
    const restore = setGlobals(dom);
    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      value: async () => ({ ok: true, json: async () => [] }),
    });
    try {
      const document = dom.window.document;
      const root = document.querySelector<HTMLElement>("[data-chart-root]")!;
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      let fallbackCopied = false;
      Object.defineProperty(document, "execCommand", { configurable: true, value: () => { fallbackCopied = true; return true; } });
      await copySvgToClipboard(svg, { document, clipboard: undefined });
      assert.equal(fallbackCopied, true);
      assert.equal(document.querySelector("textarea"), null);
      Object.defineProperty(document, "execCommand", { configurable: true, value: () => false });
      await assert.rejects(copySvgToClipboard(svg, {
        document,
        clipboard: { writeText: async () => { throw new Error("denied"); } },
      }), /Clipboard access is unavailable/);
      mountChartPage({
        parseData: (data: unknown) => data,
        charts: [{ id: "only", label: "Only", alt: "One chart", render: () =>
          document.createElementNS("http://www.w3.org/2000/svg", "svg") }],
      });
      await wait();
      assert.equal(document.querySelector<HTMLElement>("[data-chart-tabs]")?.hidden, true);
      assert.equal(root.getAttribute("role"), "region");
      assert.equal(root.hasAttribute("aria-labelledby"), false);
      assert.equal(document.querySelectorAll("[role=tab]").length, 0);
    } finally {
      restore();
      dom.window.close();
    }
  });

  it("renders an error and disables copy when the data request fails", async () => {
    const dom = new JSDOM(`<div data-chart-tabs></div><div data-chart-root></div><button data-copy-svg></button>`,
      { url: "https://example.test/" });
    const restore = setGlobals(dom);
    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      value: async () => ({ ok: false, status: 503 }),
    });
    try {
      const document = dom.window.document;
      const root = document.querySelector<HTMLElement>("[data-chart-root]")!;
      const copyButton = document.querySelector<HTMLButtonElement>("[data-copy-svg]")!;
      mountChartPage({
        parseData: (value: unknown) => value,
        charts: [{ id: "main", label: "Main", alt: "Chart", render: () =>
          document.createElementNS("http://www.w3.org/2000/svg", "svg") }],
      });
      await wait();
      assert.equal(root.textContent, "Chart unavailable: Could not load chart data (HTTP 503).");
      assert.equal(copyButton.disabled, true);
    } finally {
      restore();
      dom.window.close();
    }
  });

  it("retains the initial SVG while loading and if interactive enhancement fails", async () => {
    const dom = new JSDOM(`<div data-chart-root><svg role="img" aria-label="Static chart"><text>Initial chart</text></svg></div>
      <button data-copy-svg></button><span data-copy-status role="status"></span>`,
    { url: "https://example.test/" });
    const restore = setGlobals(dom);
    let failRequest!: (value: unknown) => void;
    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      value: () => new Promise(resolve => { failRequest = resolve; }),
    });
    try {
      const document = dom.window.document;
      const root = document.querySelector<HTMLElement>("[data-chart-root]")!;
      const initial = root.querySelector("svg");
      mountChartPage({
        parseData: (value: unknown) => value,
        charts: [{ id: "main", label: "Main", alt: "Chart", render: () =>
          document.createElementNS("http://www.w3.org/2000/svg", "svg") }],
      });
      assert.equal(root.querySelector("svg"), initial);
      failRequest({ ok: false, status: 503 });
      await wait();
      assert.equal(root.querySelector("svg"), initial);
      assert.equal(root.getAttribute("aria-busy"), "false");
      assert.equal(document.querySelector<HTMLButtonElement>("[data-copy-svg]")?.disabled, false);
      assert.match(document.querySelector("[data-copy-status]")?.textContent ?? "", /showing the static chart/);
    } finally {
      restore();
      dom.window.close();
    }
  });
});
