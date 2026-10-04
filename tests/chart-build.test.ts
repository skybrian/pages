import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { it } from "node:test";
import { finishChartBuild, renderInitialCharts } from "../scripts/build-charts.js";

it("shares chart imports within a build and reloads the whole dependency tree between builds", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "chart-loader-"));
  const marker = path.join(root, "imports.txt");
  const input = path.join(root, "index.md");
  const chart = (label: string) => `
    import { appendFileSync } from "node:fs";
    import { value } from "./helper.ts";
    appendFileSync(${JSON.stringify(marker)}, "loaded\\n");
    export default {
      parseData(data) { return data; },
      charts: [{ id: "main", label: ${JSON.stringify(label)}, alt: "Test chart",
        render(data, {document}) {
          const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
          const text = document.createElementNS(svg.namespaceURI, "text");
          text.textContent = ${JSON.stringify(label)} + ":" + value + ":" + data.value;
          svg.append(text);
          return svg;
        }
      }]
    };
  `;
  try {
    await writeFile(path.join(root, "helper.ts"), 'export const value: string = "first";');
    await writeFile(path.join(root, "chart.ts"), chart("Original"));
    await writeFile(path.join(root, "data.json"), '{"value":1}');
    const results = await Promise.all([
      renderInitialCharts(input, "tabs"),
      renderInitialCharts(input),
      renderInitialCharts(input),
    ]);
    assert.match(results[1]!, /Original:first:1/);
    assert.match(results[2]!, /Original:first:1/);
    assert.equal(await readFile(marker, "utf8"), "loaded\n",
      "tabs and all SVG sizes must share one chart evaluation");

    await finishChartBuild();
    await writeFile(path.join(root, "helper.ts"), 'export const value: string = "second";');
    await writeFile(path.join(root, "data.json"), '{"value":2}');
    assert.match(await renderInitialCharts(input), /Original:second:2/,
      "a rebuild must invalidate imported helpers, not just chart.ts");
    assert.equal(await readFile(marker, "utf8"), "loaded\nloaded\n");

    await finishChartBuild();
    await writeFile(path.join(root, "chart.ts"), chart("Edited"));
    assert.match(await renderInitialCharts(input), /Edited:second:2/);

    // A validation error must reach the parent and must not poison later builds.
    await finishChartBuild();
    await writeFile(path.join(root, "data.json"), "invalid JSON");
    await assert.rejects(renderInitialCharts(input), /JSON/);
    await finishChartBuild();
    await writeFile(path.join(root, "data.json"), '{"value":3}');
    assert.match(await renderInitialCharts(input), /Edited:second:3/);
  } finally {
    await finishChartBuild();
    await rm(root, { recursive: true, force: true });
  }
});

it("rejects outstanding requests when a chart worker exits and can start a new build", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "chart-worker-exit-"));
  try {
    await writeFile(path.join(root, "chart.ts"), "process.exit(7);");
    const requests = await Promise.allSettled([
      renderInitialCharts(path.join(root, "index.md")),
      renderInitialCharts(path.join(root, "index.md"), "tabs"),
    ]);
    for (const result of requests) {
      assert.equal(result.status, "rejected");
      if (result.status === "rejected") assert.match(result.reason.message, /exited \(7\)/);
    }
    await writeFile(path.join(root, "chart.ts"), `export default {
      parseData(data) { return data; },
      charts: [{ id: "main", label: "Main", alt: "Recovered",
        render(data, {document}) {
          return document.createElementNS("http://www.w3.org/2000/svg", "svg");
        }
      }]
    };`);
    await writeFile(path.join(root, "data.json"), "[]");
    assert.match(await renderInitialCharts(path.join(root, "index.md")), /aria-label="Recovered"/);
  } finally {
    await finishChartBuild();
    await rm(root, { recursive: true, force: true });
  }
});
