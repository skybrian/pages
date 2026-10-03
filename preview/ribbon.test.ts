import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createPreviewUrlLookup, isPreviewRunMode, previewSourceUrl } from "./ribbon.js";

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

  it("resolves only generated pages and replaces stale mappings after rebuilds", () => {
    const lookup = createPreviewUrlLookup("/repo");
    lookup.refresh([
      { inputPath: "/repo/src/index.njk", url: "/" },
      { inputPath: "./src/pages/posts/one/index.md", url: "/custom/one/" },
      { inputPath: "/repo/src/pages/chart.ts", url: false },
      { inputPath: "/elsewhere/private.md", url: "/private/" },
      { inputPath: "/repo/src/orphan.md" },
    ]);
    assert.equal(lookup.resolve("src/index.njk"), "/");
    assert.equal(lookup.resolve("src/pages/posts/one/index.md"), "/custom/one/");
    assert.equal(lookup.resolve("src/pages/chart.ts"), undefined);
    assert.equal(lookup.resolve("src/orphan.md"), undefined);
    assert.equal(lookup.resolve("src/pages/private.md"), undefined);

    lookup.refresh([{ inputPath: "/repo/src/index.njk", url: "/" }]);
    assert.equal(lookup.resolve("src/pages/posts/one/index.md"), undefined);
  });
});
