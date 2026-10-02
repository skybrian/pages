import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderDocument } from "./render.tsx";

describe("renderDocument", () => {
  it("renders JSX with an HTML doctype", () => {
    assert.equal(
      renderDocument(<main><h1>Preview</h1></main>),
      "<!doctype html><main><h1>Preview</h1></main>",
    );
  });

  it("escapes text and attribute values", () => {
    assert.equal(
      renderDocument(<p title={'"quoted"'}>Fish &amp; chips &amp; tea</p>),
      '<!doctype html><p title="&quot;quoted&quot;">Fish &amp; chips &amp; tea</p>',
    );
  });
});
