import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isPreviewRunMode, previewSourceUrl } from "./ribbon.js";

describe("preview ribbon source links", () => {
  it("enables the ribbon only for Eleventy serve mode", () => {
    assert.equal(isPreviewRunMode("serve"), true);
    assert.equal(isPreviewRunMode("build"), false);
    assert.equal(isPreviewRunMode(undefined), false);
  });

  it("maps source paths into the read-only browser and encodes each path segment", () => {
    assert.equal(previewSourceUrl("./src/index.njk"), "/admin/files/src/index.njk");
    assert.equal(
      previewSourceUrl("./src/pages/a post/index file.md"),
      "/admin/files/src/pages/a%20post/index%20file.md",
    );
  });

  it("rejects paths that cannot safely map inside the repository", () => {
    assert.throws(() => previewSourceUrl("../outside.njk"));
    assert.throws(() => previewSourceUrl("/absolute/path.njk"));
  });
});
