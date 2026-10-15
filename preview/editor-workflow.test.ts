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

const original = "# Original\n";
const hash = "hash-v1";
const ok = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { "content-type": "application/json" },
});

function makeEditor(fetcher: typeof fetch = fetch, confirm: (message: string) => boolean = () => true) {
  const encoded = Buffer.from(original).toString("base64");
  const tabNames = ["rendered", "source", "editor", "changes"] as const;
  const markup = tabNames.map((name, index) => `
    <button id="file-tab-${name}" role="tab" aria-selected="${index === 0}" tabindex="${index === 0 ? 0 : -1}">${name}</button>
    <section id="file-panel-${name}" role="tabpanel" ${index === 0 ? "" : "hidden"}>
      ${name === "editor" ? `<div id="markdown-editor" data-source="${encoded}">
        <div id="editor-host"></div><p id="editor-status" role="status"></p>
        <button id="reload-markdown" hidden>Reload</button>
      </div>` : ""}
      ${name === "rendered" ? `<div id="file-rendered-content">Original</div>` : ""}
      ${name === "source" ? `<pre><code id="file-source-code">${original}</code></pre>` : ""}
      ${name === "changes" ? `<p id="file-changes-status" role="status"></p><pre id="file-changes-diff" hidden></pre>
        <button id="revert-to-head" hidden>Revert to HEAD</button>` : ""}
    </section>`).join("");
  const dom = new JSDOM(`<!doctype html><html><head>
    <meta name="pages-edit-token" content="csrf">
    <meta name="pages-source-hash" content="${hash}">
  </head><body>
    <p id="file-view-status" role="status"></p><div role="tablist">${markup}</div>
  </body></html>`, {
    url: "http://localhost/admin/files/page.md",
    runScripts: "outside-only",
    pretendToBeVisual: true,
    virtualConsole: new VirtualConsole(),
    beforeParse(window) {
      class ResizeObserver { observe() {} unobserve() {} disconnect() {} }
      Object.assign(window, {
        ResizeObserver,
        requestAnimationFrame: (callback: FrameRequestCallback) => window.setTimeout(() => callback(Date.now()), 0),
        cancelAnimationFrame: (id: number) => window.clearTimeout(id),
        confirm,
        fetch: fetcher,
      });
      window.Range.prototype.getBoundingClientRect = () => new window.DOMRect(0, 0, 0, 0);
      window.Range.prototype.getClientRects = () => ({
        length: 0, item: () => null, [Symbol.iterator]: function* () {},
      }) as DOMRectList;
      window.HTMLElement.prototype.getBoundingClientRect = () => new window.DOMRect(0, 0, 800, 24);
    },
  });
  const { window } = dom;
  window.eval(client);
  const click = (name: string) => window.document.querySelector<HTMLButtonElement>(`#file-tab-${name}`)!.click();
  const editorText = () => window.document.querySelector<HTMLElement>(".cm-content")!;
  const replace = (value: string) => {
    const element = editorText();
    element.focus();
    element.textContent = value;
    element.dispatchEvent(new window.InputEvent("input", { bubbles: true, inputType: "insertText", data: value }));
  };
  return { window, click, replace, editorText };
}

const snapshot = (content = original, currentHash = hash) => ({
  content, hash: currentHash, renderedHtml: `<h1>${content.trim()}</h1>`,
  diff: "-old\n+new\n", canRevert: true, gitStatus: "tracked",
});
const wait = (ms = 560) => new Promise((resolve) => setTimeout(resolve, ms));

describe("preview file tabs and autosaving editor", () => {
  it("defaults to Rendered and supports accessible arrow-key tab navigation", async () => {
    let gets = 0;
    const { window } = makeEditor((async () => { gets++; return ok(snapshot()); }) as typeof fetch);
    assert.equal(window.document.querySelector("#file-tab-rendered")!.getAttribute("aria-selected"), "true");
    const sourceTab = window.document.querySelector<HTMLButtonElement>("#file-tab-source")!;
    sourceTab.dispatchEvent(new window.KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true }));
    await wait(30);
    assert.equal(window.document.querySelector("#file-tab-editor")!.getAttribute("aria-selected"), "true");
    assert.equal(gets, 1);
    window.close();
  });

  it("loads the editor from a fresh read and autosaves after a debounce", async () => {
    const requests: Array<{ method: string; body?: Record<string, unknown> }> = [];
    const { window, click, replace } = makeEditor((async (_url, init) => {
      const method = init?.method ?? "GET";
      requests.push({ method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      return method === "GET" ? ok(snapshot()) : ok({ hash: "hash-v2" });
    }) as typeof fetch);
    click("editor");
    await wait(30);
    replace("# Changed\n");
    await wait();
    assert.deepEqual(requests.filter(({ method }) => method === "POST").map(({ body }) => body), [
      { content: "# Changed\n", hash },
    ]);
    assert.match(window.document.querySelector("#editor-status")!.textContent!, /Saved/i);
    window.close();
  });

  it("serializes typing during an in-flight save and flushes both versions before switching", async () => {
    let resolveFirst!: (response: Response) => void;
    const first = new Promise<Response>((resolve) => { resolveFirst = resolve; });
    const posts: Array<Record<string, unknown>> = [];
    const { window, click, replace } = makeEditor((async (_url, init) => {
      if (init?.method !== "POST") return ok(snapshot());
      const payload = JSON.parse(String(init.body));
      posts.push(payload);
      if (posts.length === 1) return first;
      return ok({ hash: "hash-v3" });
    }) as typeof fetch);
    click("editor");
    await wait(30);
    replace("# First\n");
    await wait();
    replace("# Second\n");
    const switching = (window.document.querySelector("#file-tab-source") as HTMLButtonElement).click();
    resolveFirst(ok({ hash: "hash-v2" }));
    await switching;
    await wait(30);
    assert.deepEqual(posts, [
      { content: "# First\n", hash },
      { content: "# Second\n", hash: "hash-v2" },
    ]);
    assert.equal(window.document.querySelector("#file-tab-source")!.getAttribute("aria-selected"), "true");
    window.close();
  });

  it("keeps typing made during the tab-refresh request and saves it before leaving", async () => {
    let releaseRefresh!: (response: Response) => void;
    const delayedRefresh = new Promise<Response>((resolve) => { releaseRefresh = resolve; });
    let gets = 0;
    const posts: Array<Record<string, unknown>> = [];
    const { window, click, replace } = makeEditor((async (_url, init) => {
      if (init?.method !== "POST") {
        gets++;
        return gets === 2 ? delayedRefresh : ok(snapshot());
      }
      const payload = JSON.parse(String(init.body));
      posts.push(payload);
      return ok({ hash: `hash-v${posts.length + 1}` });
    }) as typeof fetch);
    click("editor");
    await wait(30);
    replace("# First saved\n");
    await wait();
    click("source");
    await wait(30);
    replace("# Typed during refresh\n");
    releaseRefresh(ok(snapshot("# First saved\n", "hash-v2")));
    await wait(600);
    assert.deepEqual(posts.map(({ content }) => content), [
      "# First saved\n",
      "# Typed during refresh\n",
    ]);
    assert.equal(window.document.querySelector("#file-tab-source")!.getAttribute("aria-selected"), "true");
    window.close();
  });

  it("blocks a tab switch on save failure and preserves edits for retry/recovery", async () => {
    let posts = 0;
    const { window, click, replace } = makeEditor((async (_url, init) => {
      if (init?.method !== "POST") return ok(snapshot());
      posts++;
      return new Response("nope", { status: 500 });
    }) as typeof fetch);
    click("editor");
    await wait(30);
    replace("# Keep me\n");
    await wait();
    click("source");
    await wait(30);
    assert.equal(window.document.querySelector("#file-tab-editor")!.getAttribute("aria-selected"), "true");
    assert.match(window.document.querySelector(".cm-content")!.textContent!, /Keep me/);
    assert.ok(posts >= 1);
    assert.match(window.document.querySelector("#editor-status")!.textContent!, /failed/i);
    window.close();
  });

  it("blocks switching on a hash conflict and exposes the explicit reload action", async () => {
    const { window, click, replace } = makeEditor((async (_url, init) => {
      if (init?.method !== "POST") return ok(snapshot());
      return new Response(JSON.stringify({ error: "conflict" }), { status: 409 });
    }) as typeof fetch);
    click("editor");
    await wait(30);
    replace("# Preserve conflict\n");
    await wait();
    click("changes");
    await wait(30);
    assert.equal(window.document.querySelector("#file-tab-editor")!.getAttribute("aria-selected"), "true");
    assert.equal(window.document.querySelector("#reload-markdown")!.hasAttribute("hidden"), false);
    assert.match(window.document.querySelector(".cm-content")!.textContent!, /Preserve conflict/);
    window.close();
  });

  it("loads diff metadata and reverts to HEAD with confirmation", async () => {
    let revertBody: Record<string, unknown> | undefined;
    const { window, click } = makeEditor((async (_url, init) => {
      if (init?.method !== "POST") return ok(snapshot());
      revertBody = JSON.parse(String(init.body));
      return ok(snapshot(original, "hash-restored"));
    }) as typeof fetch);
    let highlightRequests = 0;
    window.document.addEventListener("syntax-highlight", () => { highlightRequests++; });
    click("changes");
    await wait(30);
    assert.match(window.document.querySelector("#file-changes-diff")!.textContent!, /-old/);
    const revert = window.document.querySelector<HTMLButtonElement>("#revert-to-head")!;
    assert.equal(revert.disabled, false);
    revert.click();
    await wait(30);
    assert.deepEqual(revertBody, { action: "revert", hash });
    assert.equal(window.document.querySelector("#file-source-code")!.textContent, original);
    assert.equal(highlightRequests, 2, "refreshed source requests syntax highlighting");
    window.close();
  });

  it("does not revert if the confirmation is declined", async () => {
    let posts = 0;
    const { window, click } = makeEditor((async (_url, init) => {
      if (init?.method === "POST") posts++;
      return ok(snapshot());
    }) as typeof fetch, () => false);
    click("changes");
    await wait(30);
    window.document.querySelector<HTMLButtonElement>("#revert-to-head")!.click();
    await wait(30);
    assert.equal(posts, 0);
    window.close();
  });

  it("does not run a queued Changes revert after Editor becomes active", async () => {
    let releaseEditorLoad!: (response: Response) => void;
    const delayedEditorLoad = new Promise<Response>((resolve) => { releaseEditorLoad = resolve; });
    let gets = 0;
    let posts = 0;
    const { window, click } = makeEditor((async (_url, init) => {
      if (init?.method === "POST") {
        posts++;
        return ok(snapshot());
      }
      gets++;
      return gets === 2 ? delayedEditorLoad : ok(snapshot());
    }) as typeof fetch);
    click("changes");
    await wait(30);
    click("editor");
    await wait(30);
    window.document.querySelector<HTMLButtonElement>("#revert-to-head")!.click();
    releaseEditorLoad(ok(snapshot()));
    await wait(30);
    assert.equal(window.document.querySelector("#file-tab-editor")!.getAttribute("aria-selected"), "true");
    assert.equal(posts, 0);
    window.close();
  });
});
