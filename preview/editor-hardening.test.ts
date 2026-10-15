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

function setup(options: { source: string; hash?: string; draft?: string; fetch?: typeof fetch }) {
  const encoded = Buffer.from(options.source).toString("base64");
  const tabs = ["rendered", "source", "editor", "changes"] as const;
  const markup = tabs.map((name, index) => `
    <button id="file-tab-${name}" role="tab" aria-selected="${index === 0}" tabindex="${index === 0 ? 0 : -1}"></button>
    <section id="file-panel-${name}" role="tabpanel" ${index ? "hidden" : ""}>
      ${name === "editor" ? `<div id="markdown-editor" data-source="${encoded}"><div id="editor-host"></div>
        <p id="editor-status" role="status"></p><button id="reload-markdown" hidden>Reload</button></div>` : ""}
      ${name === "source" ? `<pre><code id="file-source-code"></code></pre>` : ""}
      ${name === "rendered" ? `<div id="file-rendered-content"></div>` : ""}
      ${name === "changes" ? `<p id="file-changes-status" role="status"></p><pre id="file-changes-diff" hidden></pre>
        <button id="revert-to-head" hidden></button>` : ""}
    </section>`).join("");
  const dom = new JSDOM(`<!doctype html><meta name="pages-edit-token" content="csrf">
    <meta name="pages-source-hash" content="${options.hash ?? "hash-new"}"><body>
    <p id="file-view-status" role="status"></p><div role="tablist">${markup}</div></body>`, {
    url: "http://localhost/admin/files/page.md", runScripts: "outside-only", pretendToBeVisual: true,
    virtualConsole: new VirtualConsole(),
    beforeParse(window) {
      class ResizeObserver { observe() {} unobserve() {} disconnect() {} }
      Object.assign(window, {
        ResizeObserver,
        requestAnimationFrame: (callback: FrameRequestCallback) => window.setTimeout(() => callback(Date.now()), 0),
        cancelAnimationFrame: (id: number) => window.clearTimeout(id),
        confirm: () => true,
        fetch: options.fetch ?? (async () => new Response(JSON.stringify({
          content: options.source, hash: options.hash ?? "hash-new", renderedHtml: "", diff: "",
          canRevert: false, gitStatus: "tracked",
        }), { status: 200 })) as typeof fetch,
      });
      window.Range.prototype.getBoundingClientRect = () => new window.DOMRect(0, 0, 0, 0);
      window.Range.prototype.getClientRects = () => ({
        length: 0, item: () => null, [Symbol.iterator]: function* () {},
      }) as DOMRectList;
      window.HTMLElement.prototype.getBoundingClientRect = () => new window.DOMRect(0, 0, 800, 24);
    },
  });
  const { window } = dom;
  const key = `pages-markdown-draft:${window.location.pathname}`;
  if (options.draft !== undefined) window.sessionStorage.setItem(key, options.draft);
  window.eval(client);
  const click = (tab: string) => window.document.querySelector<HTMLButtonElement>(`#file-tab-${tab}`)!.click();
  const replace = (value: string) => {
    const content = window.document.querySelector<HTMLElement>(".cm-content");
    assert(content);
    content.textContent = value;
    content.dispatchEvent(new window.InputEvent("input", { bubbles: true, inputType: "insertText", data: value }));
  };
  return { window, click, replace, key };
}
const wait = (ms = 30) => new Promise((resolve) => setTimeout(resolve, ms));

describe("Markdown editor hardening", () => {
  it("retains a UTF-8 BOM and uniform CRLF line endings when autosaving", async () => {
    const source = "\uFEFFfirst\r\nsecond\r\n";
    const submitted: Array<{ content: string; hash: string }> = [];
    const { window, click, replace } = setup({
      source,
      fetch: (async (_url, init) => {
        if (init?.method === "POST") {
          submitted.push(JSON.parse(String(init.body)));
          return new Response(JSON.stringify({ hash: "hash-saved" }));
        }
        return new Response(JSON.stringify({
          content: source, hash: "hash-new", renderedHtml: "", diff: "",
          canRevert: false, gitStatus: "tracked",
        }));
      }) as typeof fetch,
    });
    try {
      click("editor");
      await wait();
      replace("\uFEFFchanged\r\nsecond\r\n");
      await wait(600);
      assert.deepEqual(submitted, [{
        content: "\uFEFFchanged\r\nsecond\r\n", hash: "hash-new",
      }]);
    } finally {
      window.close();
    }
  });

  it("does not upgrade a stale draft base hash when restoring it", async () => {
    const stale = JSON.stringify({ content: "# stale draft\n", baseHash: "old-hash" });
    const { window, click, replace, key } = setup({
      source: "# disk is newer\n", hash: "new-hash", draft: stale,
    });
    click("editor");
    await wait();
    assert.equal(window.document.querySelector("#reload-markdown")!.hasAttribute("hidden"), false);
    replace("# edited stale draft\n");
    await wait();
    const stored = JSON.parse(window.sessionStorage.getItem(key)!);
    assert.equal(stored.baseHash, "old-hash");
    assert.equal(stored.content, "# edited stale draft\n");
    window.close();
  });

  it("clears stale recovery and conflict state after undoing to fresh disk contents", async () => {
    const { window, click, replace, key } = setup({
      source: "# current disk\n",
      hash: "new-hash",
      draft: JSON.stringify({ content: "# stale draft\n", baseHash: "old-hash" }),
    });
    click("editor");
    await wait();
    assert.equal(window.document.querySelector("#reload-markdown")!.hasAttribute("hidden"), false);
    replace("# current disk\n");
    await wait();
    assert.equal(window.sessionStorage.getItem(key), null);
    click("source");
    await wait();
    click("editor");
    await wait();
    assert.equal(window.document.querySelector("#reload-markdown")!.hasAttribute("hidden"), true);
    assert.match(window.document.querySelector("#editor-status")!.textContent!, /Saved/i);
    replace("# new edit from fresh source\n");
    await wait(600);
    assert.match(window.document.querySelector("#editor-status")!.textContent!, /Saved/i);
    window.close();
  });

  it("warns and disables autosave for mixed line endings", async () => {
    let posts = 0;
    const source = "one\r\ntwo\nthree\r\n";
    const { window, click, replace } = setup({
      source,
      fetch: (async (_url, init) => {
        if (init?.method === "POST") posts++;
        return new Response(JSON.stringify({
          content: source, hash: "hash-new", renderedHtml: "", diff: "",
          canRevert: false, gitStatus: "tracked",
        }), { status: 200 });
      }) as typeof fetch,
    });
    click("editor");
    await wait();
    replace(`${source}changed\n`);
    await new Promise((resolve) => setTimeout(resolve, 600));
    assert.equal(posts, 0);
    assert.match(window.document.querySelector("#editor-status")!.textContent!, /mixed line endings/i);
    window.close();
  });

  it("persists pending debounced edits before an accepted unload", async () => {
    const { window, click, replace, key } = setup({ source: "# source\n" });
    click("editor");
    await wait();
    replace("# pending draft\n");
    await wait();
    const event = new window.Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    assert.equal(event.defaultPrevented, true);
    assert.equal(JSON.parse(window.sessionStorage.getItem(key)!).content, "# pending draft\n");
    window.close();
  });

  it("preserves the current document if unload happens during a save after undo", async () => {
    let resolveSave!: (response: Response) => void;
    let posts = 0;
    const { window, click, replace, key } = setup({
      source: "# source\n",
      fetch: (async (_url, init) => {
        if (init?.method === "POST") {
          posts++;
          return new Promise<Response>((resolve) => { resolveSave = resolve; });
        }
        return new Response(JSON.stringify({
          content: "# source\n", hash: "hash-new", renderedHtml: "", diff: "",
          canRevert: false, gitStatus: "tracked",
        }), { status: 200 });
      }) as typeof fetch,
    });
    click("editor");
    await wait();
    replace("# submitted snapshot\n");
    await new Promise((resolve) => setTimeout(resolve, 560));
    assert.equal(posts, 1);
    replace("# source\n");
    await wait();
    const event = new window.Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    const draft = JSON.parse(window.sessionStorage.getItem(key)!);
    assert.equal(draft.content, "# source\n");
    assert.equal(draft.baseHash, "hash-new");
    assert.equal(event.defaultPrevented, true);
    resolveSave(new Response(JSON.stringify({ hash: "hash-saved" }), { status: 200 }));
    window.close();
  });
});
