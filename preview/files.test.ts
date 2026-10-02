import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createServer, request } from "node:http";
import { after, before, describe, it } from "node:test";
import { createFileBrowserMiddleware } from "./files.ts";

describe("preview file browser", () => {
  let root: string;
  let outside: string;
  let server: ReturnType<typeof createServer>;
  let origin: string;

  function rawGet(requestPath: string): Promise<number> {
    return new Promise((resolve, reject) => {
      const address = new URL(origin);
      const outgoing = request({
        hostname: address.hostname,
        port: address.port,
        path: requestPath,
      }, (response) => {
        response.resume();
        response.on("end", () => resolve(response.statusCode ?? 0));
      });
      outgoing.on("error", reject);
      outgoing.end();
    });
  }

  before(async () => {
    root = await mkdtemp(path.join(tmpdir(), "pages-browser-"));
    outside = await mkdtemp(path.join(tmpdir(), "pages-outside-"));
    await mkdir(path.join(root, "nested"));
    await writeFile(path.join(root, ".hidden"), "hidden");
    await writeFile(path.join(root, "nested", "hello <&.html"), "<script>bad()</script>");
    await writeFile(path.join(outside, "secret"), "secret");
    await symlink(outside, path.join(root, "escape"));
    server = createServer((req, res) => {
      void createFileBrowserMiddleware(root)(req, res, () => {
        res.statusCode = 418;
        res.end("fell through");
      });
    });
    server.listen(0);
    await once(server, "listening");
    const address = server.address();
    assert(address && typeof address === "object");
    origin = `http://127.0.0.1:${address.port}`;
  });

  after(async () => {
    server.close();
    await once(server, "close");
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  });

  it("lists root, including dotfiles, sorts directories first, and navigates", async () => {
    const response = await fetch(`${origin}/admin/files/`);
    const body = await response.text();
    assert.equal(response.status, 200);
    assert.match(body, /\.hidden/);
    assert.ok(body.indexOf("nested/") < body.indexOf(".hidden"));
    assert.match(body, /href="\/admin\/files\/nested\/"/);
    assert.match(body, /symlink blocked/);
    assert.match((await fetch(`${origin}/admin/files/nested/`)).status.toString(), /^200$/);
  });

  it("escapes labels and encodes URL components", async () => {
    const body = await (await fetch(`${origin}/admin/files/nested/`)).text();
    assert.match(body, /hello &lt;&amp;\.html/);
    assert.match(body, /hello%20%3C%26\.html/);
  });

  it("serves files only as forced downloads and supports HEAD", async () => {
    const url = `${origin}/admin/files/nested/hello%20%3C%26.html`;
    const response = await fetch(url);
    assert.equal(await response.text(), "<script>bad()</script>");
    assert.equal(response.headers.get("content-type"), "application/octet-stream");
    assert.match(response.headers.get("content-disposition")!, /^attachment;/);
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    assert.equal(response.headers.get("cache-control"), "no-store");
    const head = await fetch(url, { method: "HEAD" });
    assert.equal(head.status, 200);
    assert.equal(await head.text(), "");
  });

  it("rejects unsupported methods, traversal, malformed escapes, and symlinks", async () => {
    assert.equal((await fetch(`${origin}/admin/files/`, { method: "POST" })).status, 405);
    assert.equal(await rawGet("/admin/files/%2e%2e/etc/passwd"), 400);
    assert.equal(await rawGet("/admin/files/%ZZ"), 400);
    assert.equal(await rawGet("/admin/files/a%2f..%2fetc"), 400);
    assert.equal((await fetch(`${origin}/admin/files/escape/secret`)).status, 404);
  });

  it("returns 404 for missing paths and falls through outside the route boundary", async () => {
    assert.equal((await fetch(`${origin}/admin/files/missing`)).status, 404);
    const boundary = await fetch(`${origin}/admin/files-other`);
    assert.equal(boundary.status, 418);
    assert.equal(await boundary.text(), "fell through");
  });
});
