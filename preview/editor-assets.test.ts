import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { after, before, describe, it } from "node:test";
import { createEditorAssetsMiddleware } from "./editor-assets.ts";

describe("preview Markdown editor bundle", () => {
  const middleware = createEditorAssetsMiddleware();
  const server = createServer((req, res) => middleware(req, res, () => {
    res.statusCode = 418;
    res.end();
  }));
  let origin: string;
  before(async () => {
    server.listen(0);
    await once(server, "listening");
    const address = server.address();
    assert(address && typeof address === "object");
    origin = `http://127.0.0.1:${address.port}`;
  });
  after(async () => {
    server.close();
    await once(server, "close");
  });
  it("serves a local CodeMirror bundle only at its allowlisted route", async () => {
    const response = await fetch(`${origin}/admin/assets/editor/editor.js`);
    const body = await response.text();
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type")!, /javascript/);
    assert.match(body, /markdown/i);
    assert.match(body, /EditorView|codemirror/i);
    assert.equal((await fetch(`${origin}/admin/assets/editor/other.js`)).status, 418);
    assert.equal((await fetch(`${origin}/admin/assets/editor/editor.js`, { method: "POST" })).status, 405);
  });
});
