import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createServer, request } from "node:http";
import { after, before, describe, it } from "node:test";
import { createFileBrowserMiddleware, languageForFilename } from "./files.ts";
import { createMicrolighterAssetsMiddleware } from "./microlighter-assets.ts";

describe("preview file browser", () => {
  let root: string;
  let outside: string;
  let server: ReturnType<typeof createServer>;
  let origin: string;
  let fileMiddleware: ReturnType<typeof createFileBrowserMiddleware>;
  let assetsMiddleware: ReturnType<typeof createMicrolighterAssetsMiddleware>;

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
    await mkdir(path.join(root, "crumb & <folder>"));
    await mkdir(path.join(root, "..notes"));
    await writeFile(path.join(root, ".hidden"), "hidden");
    await writeFile(path.join(root, "nested", "hello <&.html"), "<script>alert('x')</script>");
    await writeFile(path.join(root, "README"), "plain UTF-8: café");
    await writeFile(path.join(root, ".gitignore"), "node_modules/\n");
    await writeFile(path.join(root, "sample.ts"), "const answer: number = 42;");
    await writeFile(path.join(root, "unknown.xyz"), "<not markup>");
    await writeFile(path.join(root, "binary.txt"), Buffer.from([0x41, 0x00, 0x42]));
    await writeFile(path.join(root, "invalid-utf8.txt"), Buffer.from([0xc3, 0x28]));
    await writeFile(path.join(root, "large.txt"), Buffer.alloc(1024 * 1024 + 1, 0x61));
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADUlEQVQImWNgYGD4DwABBAEAfbLI3wAAAABJRU5ErkJggg==", "base64");
    await writeFile(path.join(root, "pixel.png"), png);
    await writeFile(path.join(root, "fake.png"), "not a PNG");
    await writeFile(path.join(root, "oversized.png"), Buffer.alloc(10 * 1024 * 1024 + 1));
    await writeFile(path.join(root, "..notes", "inside.txt"), "inside notes");
    await writeFile(path.join(root, "..notes-file.txt"), "leading dots");
    await writeFile(path.join(root, "owner's file.txt"), "apostrophe");
    await writeFile(path.join(root, "hostile <style><script>.txt"), "before </script><script>alert('source')</script> after </style>");
    await writeFile(path.join(root, "crumb & <folder>", "file.txt"), "safe");
    await writeFile(path.join(outside, "secret"), "secret");
    await writeFile(path.join(outside, "secret.png"), png);
    await symlink(outside, path.join(root, "escape"));
    await symlink(path.join(outside, "secret.png"), path.join(root, "linked.png"));
    fileMiddleware = createFileBrowserMiddleware(root);
    assetsMiddleware = createMicrolighterAssetsMiddleware(path.resolve("."));
    server = createServer((req, res) => {
      void assetsMiddleware(req, res, (assetError) => {
        if (assetError) throw assetError;
        void fileMiddleware(req, res, () => {
          res.statusCode = 418;
          res.end("fell through");
        });
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

  it("renders hostile names and source as text, not markup", async () => {
    const listing = await (await fetch(`${origin}/admin/files/`)).text();
    assert.match(listing, /hostile &lt;style(?:&gt;|>)&lt;script(?:&gt;|>)/);
    assert.match(listing, /href="\/admin\/files\/hostile%20%3Cstyle%3E%3Cscript%3E\.txt"/);
    const response = await fetch(`${origin}/admin/files/hostile%20%3Cstyle%3E%3Cscript%3E.txt`);
    const body = await response.text();
    assert.equal(response.status, 200);
    assert.match(body, /before &lt;\/script(?:&gt;|>)&lt;script(?:&gt;|>)alert\(/);
    assert.match(body, /after &lt;\/style(?:&gt;|>)/);
    assert.match(body, /<title>hostile &lt;style(?:&gt;|>)&lt;script(?:&gt;|>)\.txt<\/title>/);
    assert.doesNotMatch(body, /<script>alert\('source'\)<\/script>/);
    assert.equal((body.match(/<script\b/g) ?? []).length, 1);
  });

  it("encodes breadcrumb hrefs while rendering labels as text", async () => {
    const body = await (await fetch(`${origin}/admin/files/crumb%20%26%20%3Cfolder%3E/file.txt`)).text();
    assert.match(body, /href="\/admin\/files\/crumb%20%26%20%3Cfolder%3E\/">crumb &amp; &lt;folder(?:&gt;|>)<\/a>/);
  });

  it("uses a full shared document for errors and keeps directory layout unbulleted", async () => {
    const listing = await (await fetch(`${origin}/admin/files/`)).text();
    assert.match(listing, /^<!doctype html><html><head>/);
    assert.match(listing, /ul\{list-style:none;padding-left:0\}/);
    assert.doesNotMatch(listing, /microlighter|data-syntax-theme/);
    const missing = await (await fetch(`${origin}/admin/files/missing`)).text();
    assert.match(missing, /^<!doctype html><html><head>/);
    assert.match(missing, /<title>404<\/title>/);
  });

  it("shares page margins and typography between directories and source views", async () => {
    const listing = await (await fetch(`${origin}/admin/files/`)).text();
    const source = await (await fetch(`${origin}/admin/files/sample.ts`)).text();
    const bodyStyles = (html: string) => html.match(/body\{[^}]+\}/)?.[0];
    assert.equal(bodyStyles(listing), bodyStyles(source));
    assert.match(bodyStyles(listing)!, /max-width:72rem;margin:2rem auto;padding:0 1rem;font:16px\/1\.6/);
    for (const html of [listing, source]) {
      assert.match(html, /name="viewport" content="width=device-width,initial-scale=1"/);
    }
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
    assert.match(body, /&lt;script(?:&gt;|>)alert\((?:&#39;|')x(?:&#39;|')\)&lt;\/script(?:&gt;|>)/);
    assert.doesNotMatch(body, /<script>/);
    assert.match(body, /<title>hello &lt;&amp;\.html<\/title>/);
    assert.match(body, /<nav><a href="\/admin\/files\/">root<\/a> \/ <a href="\/admin\/files\/nested\/">nested<\/a> \/ hello &lt;&amp;\.html<\/nav>/);
    assert.doesNotMatch(body, /<a href="[^"]*hello%20%3C%26\.html">hello/);
    assert.doesNotMatch(body, /Back to parent/);
    assert.match(body, /<a href="\/admin\/files\/nested\/">nested<\/a>/);
    assert.match(response.headers.get("content-type")!, /^text\/html; charset=utf-8/);
    assert.equal(response.headers.get("content-disposition"), null);
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    assert.equal(response.headers.get("cache-control"), "no-store");
    const readme = await (await fetch(`${origin}/admin/files/README`)).text();
    assert.match(readme, /plain UTF-8: café/);
    assert.match((await fetch(`${origin}/admin/files/.gitignore`)).status.toString(), /^200$/);
    const typescript = await (await fetch(`${origin}/admin/files/sample.ts`)).text();
    assert.match(typescript, /class="language-typescript"/);
    assert.match(typescript, /data-syntax-theme="github"/);
    assert.match(typescript, /microlighter\.min\.js/);
    assert.doesNotMatch(typescript, /preact|hydrate|client\.js/i);
    assert.match((await fetch(`${origin}/admin/files/unknown.xyz`)).status.toString(), /^200$/);
    const unknown = await (await fetch(`${origin}/admin/files/unknown.xyz`)).text();
    assert.match(unknown, /class="language-plaintext"/);
    assert.match(unknown, /&lt;not markup(?:&gt;|>)/);
    assert.doesNotMatch(unknown, /<not markup>/);
    const directoryListing = await (await fetch(`${origin}/admin/files/`)).text();
    assert.doesNotMatch(directoryListing, /microlighter\.min\.js/);
    const head = await fetch(url, { method: "HEAD" });
    assert.equal(head.status, 200);
    assert.equal(await head.text(), "");
  });

  it("opens validated PNGs in a new tab and serves bytes with GET and HEAD", async () => {
    const listing = await (await fetch(`${origin}/admin/files/`)).text();
    assert.match(listing, /<a href="\/admin\/files\/pixel\.png" target="_blank" rel="noopener">pixel\.png<\/a>/);
    assert.doesNotMatch(listing, /target="_blank"[^>]*>README/);
    const response = await fetch(`${origin}/admin/files/pixel.png`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "image/png");
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADUlEQVQImWNgYGD4DwABBAEAfbLI3wAAAABJRU5ErkJggg==", "base64"));
    const head = await fetch(`${origin}/admin/files/pixel.png`, { method: "HEAD" });
    assert.equal(head.status, 200);
    assert.equal(head.headers.get("content-type"), "image/png");
    assert.equal(await head.text(), "");
  });

  it("rejects mislabeled, oversized, and symlinked PNGs", async () => {
    for (const filename of ["fake.png", "oversized.png"]) {
      assert.equal((await fetch(`${origin}/admin/files/${filename}`)).status, 415);
      assert.equal((await fetch(`${origin}/admin/files/${filename}`, { method: "HEAD" })).status, 415);
      const listing = await (await fetch(`${origin}/admin/files/`)).text();
      assert.doesNotMatch(listing, new RegExp(`href="/admin/files/${filename}"`));
    }
    assert.equal((await fetch(`${origin}/admin/files/linked.png`)).status, 404);
    const listing = await (await fetch(`${origin}/admin/files/`)).text();
    assert.doesNotMatch(listing, /href="\/admin\/files\/linked\.png"/);
  });

  it("maps supported filename extensions and defaults unsupported names to plaintext", () => {
    for (const [filename, language] of [
      ["file.ts", "typescript"], ["file.js", "javascript"], ["file.json", "json"],
      ["file.css", "css"], ["file.html", "html"], ["file.md", "markdown"],
      ["file.sh", "bash"], ["file.toml", "toml"], ["file.unknown", "plaintext"],
    ]) assert.equal(languageForFilename(filename), language);
  });

  it("serves only allowlisted MicroLighter assets with safe methods and MIME types", async () => {
    const script = await fetch(`${origin}/admin/assets/microlighter/dist/microlighter.min.js`);
    assert.equal(script.status, 200);
    assert.match(script.headers.get("content-type")!, /^text\/javascript/);
    assert.match(await script.text(), /document\.addEventListener/);
    const grammar = await fetch(`${origin}/admin/assets/microlighter/dist/grammars/typescript.js`);
    assert.equal(grammar.status, 200);
    assert.match(grammar.headers.get("content-type")!, /^text\/javascript/);
    const theme = await fetch(`${origin}/admin/assets/microlighter/dist/themes/github.css`);
    assert.equal(theme.status, 200);
    assert.match(theme.headers.get("content-type")!, /^text\/css/);
    const head = await fetch(`${origin}/admin/assets/microlighter/dist/grammars/typescript.js`, { method: "HEAD" });
    assert.equal(head.status, 200);
    assert.equal(await head.text(), "");
    assert.equal((await fetch(`${origin}/admin/assets/microlighter/package.json`)).status, 404);
    assert.equal((await fetch(`${origin}/admin/assets/microlighter/dist/index.js`)).status, 404);
    assert.equal((await rawGet("/admin/assets/microlighter/%2e%2e/package.json")).status, 400);
    assert.equal((await fetch(`${origin}/admin/assets/microlighter/dist/microlighter.min.js`, { method: "POST" })).status, 405);
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
