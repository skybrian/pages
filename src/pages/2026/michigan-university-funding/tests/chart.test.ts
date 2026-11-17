import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { it } from "node:test";
import { JSDOM } from "jsdom";
import definition from "../chart.ts";

const data = definition.parseData(JSON.parse(
  await readFile(new URL("../data.json", import.meta.url), "utf8"),
));

it("renders standalone SVG views and embeds the revenue legends at compact and wide sizes", () => {
  const document = new JSDOM().window.document;
  for (const width of [360, 900]) {
    for (const chart of definition.charts) {
      const svg = chart.render(data, { document, width, height: 448, mode: "static" });
      assert.equal(svg.namespaceURI, "http://www.w3.org/2000/svg");
      assert.equal(svg.tagName, "svg");
      const legendLabels = [...svg.querySelectorAll("text")].map((node) => node.textContent);
      if (chart.id === "inflation") {
        assert.equal(legendLabels.some((label) => label === "State appropriations"), false);
      } else {
        for (const label of ["State appropriations", "Tuition and fees", "Other revenue"]) {
          assert.ok(legendLabels.includes(label), `${chart.id} at width ${width} includes ${label}`);
        }
        const label = [...svg.querySelectorAll("text")].find((node) => node.textContent === "State appropriations")!;
        assert.equal(label.getAttribute("text-anchor"), "start");
      }
    }
  }
});
