import assert from "node:assert/strict";
import { buildSync } from "esbuild";
import { JSDOM, VirtualConsole } from "jsdom";
import { describe, it } from "node:test";
import path from "node:path";

const client = buildSync({
  entryPoints: [path.resolve("preview/editor-client.ts")],
  bundle: true,
  write: false,
  platform: "browser",
  format: "iife",
  target: ["es2022"],
}).outputFiles[0]!.text;

const source = "# Original\n";
const sourceHash = "hash-v1";

function makeEditor(options: {
  source?: string;
  hash?: string;
  draft?: string;
  fetch?: typeof fetch;
  confirm?: (message: string) => boolean;
} = {}) {
  const content = options.source ?? source;
  const encoded = Buffer.from(content, "utf8").toString("base64");
  const dom = new JSDOM(`<!doctype html><html><head>
    <meta name="pages-edit-token" content="csrf">
    <meta name="pages-source-hash" content="${options.hash ?? sourceHash}">
  </head><body>
    <button id="edit-markdown">Edit</button>
    <section id="markdown-editor" hidden data-source="${encoded}">
      <div id="editor-host" aria-label="Markdown editor"></div>
      <p id="editor-status"></p>
      <button id="save-markdown">Save</button>
      <button id="cancel-markdown">Cancel</button>
      <button id="reload-markdown" hidden>Reload</button>
    </section>
    <pre><code>${content}</code></pre>
  </body></html>`, {
    url: "http://localhost/admin/files/page.md",
    runScripts: "outside-only",
    pretendToBeVisual: true,
    virtualConsole: new VirtualConsole(),
    beforeParse(window) {
      class ResizeObserver {
        observe() {}
        unobserve() {}
        disconnect() {}
      }
      Object.assign(window, {
        ResizeObserver,
        requestAnimationFrame: (callback: FrameRequestCallback) => {
          return window.setTimeout(() => callback(Date.now()), 0);
        },
        cancelAnimationFrame: (id: number) => window.clearTimeout(id),
        confirm: options.confirm ?? (() => true),
        fetch: options.fetch ?? fetch,
      });
      window.Range.prototype.getBoundingClientRect = () => new window.DOMRect(0, 0, 0, 0);
      window.Range.prototype.getClientRects = () => ({
        length: 0,
        item: () => null,
        [Symbol.iterator]: function* () {},
      }) as DOMRectList;
      window.HTMLElement.prototype.getBoundingClientRect = () => new window.DOMRect(0, 0, 800, 24);
    },
  });
  const { window } = dom;
  if (options.draft !== undefined) {
    window.sessionStorage.setItem(`pages-markdown-draft:${window.location.pathname}`, options.draft);
  }
  window.eval(client);
  const click = (selector: string) => {
    const element = window.document.querySelector<HTMLElement>(selector);
    assert(element, `missing ${selector}`);
    element.click();
    return element;
  };
  const editorContent = () => {
    const element = window.document.querySelector<HTMLElement>(".cm-content");
    assert(element, "CodeMirror content DOM was not initialized");
    return element;
  };
  const replaceDocument = (text: string) => {
    const element = editorContent();
    element.focus();
    element.textContent = text;
    element.dispatchEvent(new window.InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
  };
  const pressKey = (key: string, modifiers: { ctrlKey?: boolean; metaKey?: boolean } = {}) => {
    const element = editorContent();
    element.focus();
    element.dispatchEvent(new window.KeyboardEvent("keydown", {
      key, bubbles: true, cancelable: true, ...modifiers,
    }));
  };
  return { dom, window, click, editorContent, replaceDocument, pressKey };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

const settleInput = () => new Promise((resolve) => setTimeout(resolve, 25));

describe("preview Markdown editor workflow", () => {
  it("initializes Edit and Cancel discards edits and restores the readonly source", async () => {
    const { window, click, replaceDocument } = makeEditor({ confirm: () => true });
    click("#edit-markdown");

    assert.equal(window.document.querySelector("#markdown-editor")!.hasAttribute("hidden"), false);
    assert.equal(window.document.querySelector("pre")!.hasAttribute("hidden"), true);
    assert.match(window.document.querySelector(".cm-content")!.textContent!, /# Original/);

    replaceDocument("# Changed\n");
    await settleInput();
    click("#cancel-markdown");
    assert.equal(window.document.querySelector("#markdown-editor")!.hasAttribute("hidden"), true);
    assert.equal(window.document.querySelector("#edit-markdown")!.hasAttribute("hidden"), false);
    assert.equal(window.document.querySelector("pre")!.hasAttribute("hidden"), false);
    click("#edit-markdown");
    assert.match(window.document.querySelector(".cm-content")!.textContent!, /# Original/);
    window.close();
  });

  it("saves the submitted snapshot and keeps later typing dirty after the request resolves", async () => {
    const response = deferred<Response>();
    let submitted: { content: string; hash: string } | undefined;
    const { window, click, replaceDocument } = makeEditor({
      fetch: (async (_input: RequestInfo | URL, init?: RequestInit) => {
        submitted = JSON.parse(String(init?.body));
        return response.promise;
      }) as typeof fetch,
    });
    click("#edit-markdown");
    replaceDocument("# Submitted\n");
    await settleInput();
    click("#save-markdown");
    assert.deepEqual(submitted, { content: "# Submitted\n", hash: sourceHash });
    replaceDocument("# Submitted, then changed\n");
    await settleInput();
    response.resolve(new Response(JSON.stringify({ hash: "hash-v2" }), {
      status: 200, headers: { "content-type": "application/json" },
    }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.match(window.document.querySelector("#editor-status")!.textContent!, /newer edits are still unsaved/);
    assert.equal(window.document.querySelector("#save-markdown")!.hasAttribute("disabled"), false);
    window.close();
  });

  it("coalesces Ctrl-S while a save is in flight", async () => {
    const response = deferred<Response>();
    let calls = 0;
    const { window, click, replaceDocument } = makeEditor({
      fetch: (async () => {
        calls++;
        return response.promise;
      }) as typeof fetch,
    });
    click("#edit-markdown");
    replaceDocument("# Changed\n");
    await settleInput();
    click("#save-markdown");
    const saveKey = new window.KeyboardEvent("keydown", { key: "s", ctrlKey: true, bubbles: true, cancelable: true });
    window.document.dispatchEvent(saveKey);
    assert.equal(saveKey.defaultPrevented, true);
    assert.equal(calls, 1);
    response.resolve(new Response(JSON.stringify({ hash: "hash-v2" }), { status: 200 }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    window.close();
  });

  it("restores a draft when opening the editor", () => {
    const { window, click } = makeEditor({
      draft: JSON.stringify({ content: "# Recovered draft\n", baseHash: sourceHash }),
    });
    click("#edit-markdown");
    assert.match(window.document.querySelector(".cm-content")!.textContent!, /Recovered draft/);
    assert.match(window.document.querySelector("#editor-status")!.textContent!, /Restored unsaved edits/);
    assert.equal(window.document.querySelector("#editor-host")!.getAttribute("aria-label"), "Markdown editor");
    window.close();
  });

  it("restores but does not submit a draft based on a stale source hash", async () => {
    let calls = 0;
    const { window, click } = makeEditor({
      hash: "current-disk-hash",
      draft: JSON.stringify({ content: "# Stale but preserved\n", baseHash: "older-disk-hash" }),
      fetch: (async () => {
        calls++;
        return new Response(JSON.stringify({ hash: "unexpected" }), { status: 200 });
      }) as typeof fetch,
    });
    click("#edit-markdown");
    assert.match(window.document.querySelector(".cm-content")!.textContent!, /Stale but preserved/);
    click("#save-markdown");
    await settleInput();
    assert.equal(calls, 0);
    assert.match(window.document.querySelector("#editor-status")!.textContent!, /older source version|conflict|stale/i);
    window.close();
  });

  it("treats a legacy draft with no base hash as an untrusted conflict", async () => {
    let calls = 0;
    const { window, click } = makeEditor({
      hash: "current-disk-hash",
      draft: "# Legacy draft without a base hash\n",
      fetch: (async () => {
        calls++;
        return new Response(JSON.stringify({ hash: "unexpected" }), { status: 200 });
      }) as typeof fetch,
    });
    click("#edit-markdown");
    assert.match(window.document.querySelector(".cm-content")!.textContent!, /Legacy draft without a base hash/);
    click("#save-markdown");
    await settleInput();
    assert.equal(calls, 0);
    assert.match(window.document.querySelector("#editor-status")!.textContent!, /conflict|unknown|cannot be saved|older source/i);
    window.close();
  });

  it("preserves edits and exposes reload after the server reports a changed source", async () => {
    const { window, click, replaceDocument } = makeEditor({
      fetch: (async () => new Response("conflict", { status: 409 })) as typeof fetch,
    });
    click("#edit-markdown");
    replaceDocument("# Keep these edits\n");
    await settleInput();
    click("#save-markdown");
    await settleInput();
    assert.equal(window.document.querySelector("#reload-markdown")!.hasAttribute("hidden"), false);
    assert.match(window.document.querySelector("#editor-status")!.textContent!, /changed on disk/);
    assert.match(window.sessionStorage.getItem(`pages-markdown-draft:${window.location.pathname}`)!, /Keep these edits/);
    window.close();
  });

  it("serializes CRLF documents from the editor state and sends the current source hash", async () => {
    let submitted: { content: string; hash: string } | undefined;
    const { window, click, pressKey } = makeEditor({
      source: "first\r\nsecond",
      hash: "disk-hash",
      fetch: (async (_input: RequestInfo | URL, init?: RequestInit) => {
        submitted = JSON.parse(String(init?.body));
        return new Response(JSON.stringify({ hash: "next-hash" }), { status: 200 });
      }) as typeof fetch,
    });
    click("#edit-markdown");
    pressKey("End", { ctrlKey: true });
    pressKey("Enter");
    click("#save-markdown");
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.deepEqual(submitted, { content: "first\r\nsecond\r\n", hash: "disk-hash" });
    window.close();
  });

  it("updates the readonly source after a successful save", async () => {
    const { window, click, replaceDocument } = makeEditor({
      fetch: (async () => new Response(JSON.stringify({ hash: "new-hash" }), { status: 200 })) as typeof fetch,
    });
    click("#edit-markdown");
    replaceDocument("# Saved source\n");
    await settleInput();
    click("#save-markdown");
    await settleInput();
    assert.equal(window.document.querySelector("pre code")!.textContent, "# Saved source\n");
    window.close();
  });

  it("warns about mixed line endings and refuses to submit them", async () => {
    let calls = 0;
    const { window, click, replaceDocument } = makeEditor({
      source: "first\r\nsecond\nthird\r\n",
      fetch: (async () => {
        calls++;
        return new Response(JSON.stringify({ hash: "unexpected" }), { status: 200 });
      }) as typeof fetch,
    });
    click("#edit-markdown");
    replaceDocument("first\r\nsecond\nthird\r\nchanged\n");
    await settleInput();
    click("#save-markdown");
    await settleInput();
    assert.equal(calls, 0);
    assert.match(window.document.querySelector("#editor-status")!.textContent!, /mixed|line ending/i);
    window.close();
  });

  it("does not silently lose a leading UTF-8 BOM", async () => {
    const bomSource = "\uFEFF# Original\n";
    let submitted: { content: string; hash: string } | undefined;
    const { window, click, replaceDocument } = makeEditor({
      source: bomSource,
      fetch: (async (_input: RequestInfo | URL, init?: RequestInit) => {
        submitted = JSON.parse(String(init?.body));
        return new Response(JSON.stringify({ hash: "next-hash" }), { status: 200 });
      }) as typeof fetch,
    });
    click("#edit-markdown");
    replaceDocument("\uFEFF# Changed\n");
    await settleInput();
    click("#save-markdown");
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(submitted?.content.charCodeAt(0), 0xfeff);
    window.close();
  });
});
