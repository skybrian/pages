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

  function rawGet(requestPath: string, method = "GET"): Promise<{ status: number; headers: Headers; body: string }> {
    return new Promise((resolve, reject) => {
      const address = new URL(origin);
      const outgoing = request({
        hostname: address.hostname,
        port: address.port,
        path: requestPath,
        method,
      }, (response) => {
        let body = "";
        response.setEncoding("utf8");
        response.on("data", (chunk: string) => body += chunk);
        response.on("end", () => resolve({
          status: response.statusCode ?? 0,
          headers: new Headers(response.headers as Record<string, string>),
          body,
        }));
      });
      outgoing.on("error", reject);
      outgoing.end();
    });
  }

  before(async () => {
    root = await mkdtemp(path.join(tmpdir(), "pages-browser-"));
    outside = await mkdtemp(path.join(tmpdir(), "pages-outside-"));
    await mkdir(path.join(root, "nested"));
    await mkdir(path.join(root, "..notes"));
    await writeFile(path.join(root, ".hidden"), "hidden");
    await writeFile(path.join(root, "nested", "hello <&.html"), "<script>alert('x')</script>");
    await writeFile(path.join(root, "README"), "plain UTF-8: café");
    await writeFile(path.join(root, ".gitignore"), "node_modules/\n");
    await writeFile(path.join(root, "binary.txt"), Buffer.from([0x41, 0x00, 0x42]));
    await writeFile(path.join(root, "invalid-utf8.txt"), Buffer.from([0xc3, 0x28]));
    await writeFile(path.join(root, "large.txt"), Buffer.alloc(1024 * 1024 + 1, 0x61));
    await writeFile(path.join(root, "..notes", "inside.txt"), "inside notes");
    await writeFile(path.join(root, "..notes-file.txt"), "leading dots");
    await writeFile(path.join(root, "owner's file.txt"), "apostrophe");
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

  it("allows dot-prefixed names that are not parent traversal", async () => {
    const listing = await (await fetch(`${origin}/admin/files/`)).text();
    assert.match(listing, /href="\/admin\/files\/\.\.notes\/"/);
    assert.match(listing, /href="\/admin\/files\/\.\.notes-file\.txt"/);
    assert.match(await (await fetch(`${origin}/admin/files/..notes/`)).text(), /inside\.txt/);
    const file = await fetch(`${origin}/admin/files/..notes-file.txt`);
    assert.match(await file.text(), /leading dots/);
  });

  it("links detected text regardless of extension and renders escaped HTML with navigation", async () => {
    const listing = await (await fetch(`${origin}/admin/files/`)).text();
    assert.match(listing, /href="\/admin\/files\/README"/);
    assert.match(listing, /href="\/admin\/files\/\.gitignore"/);
    assert.match(listing, /binary\.txt<\/li>/);
    assert.doesNotMatch(listing, /href="\/admin\/files\/binary\.txt"/);
    assert.match(listing, /large\.txt<\/li>/);
    assert.doesNotMatch(listing, /href="\/admin\/files\/large\.txt"/);

    const url = `${origin}/admin/files/nested/hello%20%3C%26.html`;
    const response = await fetch(url);
    const body = await response.text();
    assert.equal(response.status, 200);
    assert.match(body, /&lt;script&gt;alert\(&#39;x&#39;\)&lt;\/script&gt;/);
    assert.doesNotMatch(body, /<script>/);
    assert.match(body, /<title>hello &lt;&amp;\.html<\/title>/);
    assert.match(body, /<a href="\/admin\/files\/nested\/">Back to parent<\/a>/);
    assert.match(response.headers.get("content-type")!, /^text\/html; charset=utf-8/);
    assert.equal(response.headers.get("content-disposition"), null);
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    assert.equal(response.headers.get("cache-control"), "no-store");
    const readme = await (await fetch(`${origin}/admin/files/README`)).text();
    assert.match(readme, /plain UTF-8: café/);
    assert.match((await fetch(`${origin}/admin/files/.gitignore`)).status.toString(), /^200$/);
    const head = await fetch(url, { method: "HEAD" });
    assert.equal(head.status, 200);
    assert.equal(await head.text(), "");
  });

  it("rejects binary, invalid UTF-8, and oversized files without exposing contents", async () => {
    for (const filename of ["binary.txt", "invalid-utf8.txt", "large.txt"]) {
      const response = await fetch(`${origin}/admin/files/${filename}`);
      assert.equal(response.status, 415);
      assert.doesNotMatch(await response.text(), /AAAA|AB/);
      assert.equal(response.headers.get("content-disposition"), null);
      const head = await fetch(`${origin}/admin/files/${filename}`, { method: "HEAD" });
      assert.equal(head.status, 415);
      assert.equal(await head.text(), "");
    }
  });

  it("rejects unsupported methods, traversal, malformed escapes, and symlinks", async () => {
    assert.equal((await fetch(`${origin}/admin/files/`, { method: "POST" })).status, 405);
    assert.equal((await rawGet("/admin/files/%2e%2e/etc/passwd")).status, 400);
    assert.equal((await rawGet("/admin/files/%ZZ")).status, 400);
    assert.equal((await rawGet("/admin/files/a%2f..%2fetc")).status, 400);
    assert.equal((await fetch(`${origin}/admin/files/escape/secret`)).status, 404);
  });

  it("returns 404 for missing paths and falls through outside the route boundary", async () => {
    assert.equal((await fetch(`${origin}/admin/files/missing`)).status, 404);
    const boundary = await fetch(`${origin}/admin/files-other`);
    assert.equal(boundary.status, 418);
    assert.equal(await boundary.text(), "fell through");
  });
});
