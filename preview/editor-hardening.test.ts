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

function openEditor(options: {
  source: string;
  hash?: string;
  draft?: string;
  fetch?: typeof fetch;
}) {
  const encoded = Buffer.from(options.source, "utf8").toString("base64");
  const dom = new JSDOM(`<!doctype html><html><head>
    <meta name="pages-edit-token" content="csrf">
    <meta name="pages-source-hash" content="${options.hash ?? "hash-new"}">
  </head><body>
    <button id="edit-markdown">Edit</button>
    <section id="markdown-editor" hidden data-source="${encoded}">
      <div id="editor-host" aria-label="Markdown editor"></div>
      <p id="editor-status"></p>
      <button id="save-markdown">Save</button>
      <button id="cancel-markdown">Cancel</button>
      <button id="reload-markdown" hidden>Reload</button>
    </section>
    <pre><code>${options.source}</code></pre>
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
        requestAnimationFrame: (callback: FrameRequestCallback) => window.setTimeout(() => callback(Date.now()), 0),
        cancelAnimationFrame: (id: number) => window.clearTimeout(id),
        confirm: () => true,
        fetch: options.fetch ?? fetch,
      });
      window.Range.prototype.getBoundingClientRect = () => new window.DOMRect(0, 0, 0, 0);
      window.Range.prototype.getClientRects = () => ({
        length: 0, item: () => null, [Symbol.iterator]: function* () {},
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
  };
  const replace = (text: string) => {
    const content = window.document.querySelector<HTMLElement>(".cm-content");
    assert(content, "editor content not initialized");
    content.textContent = text;
    content.dispatchEvent(new window.InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
  };
  return { window, click, replace };
}

describe("Markdown editor hardening", () => {
  it("does not upgrade a stale draft base hash after typing and restoring again", async () => {
    const key = "pages-markdown-draft:/admin/files/page.md";
    const originalDraft = JSON.stringify({ content: "# stale draft\n", baseHash: "hash-old" });
    const { window, click, replace } = openEditor({
      source: "# disk is newer\n",
      hash: "hash-new",
      draft: originalDraft,
    });
    click("#edit-markdown");
    assert.equal(window.document.querySelector("#save-markdown")!.hasAttribute("disabled"), true);
    replace("# stale draft, edited\n");
    await new Promise((resolve) => setTimeout(resolve, 30));
    const savedDraft = JSON.parse(window.sessionStorage.getItem(key)!);
    assert.equal(savedDraft.baseHash, "hash-old");
    assert.equal(savedDraft.content, "# stale draft, edited\n");
    window.close();

    let saves = 0;
    const restored = openEditor({
      source: "# disk is newer\n",
      hash: "hash-new",
      draft: JSON.stringify(savedDraft),
      fetch: (async () => {
        saves++;
        return new Response(JSON.stringify({ hash: "unexpected" }), { status: 200 });
      }) as typeof fetch,
    });
    restored.click("#edit-markdown");
    restored.click("#save-markdown");
    assert.equal(saves, 0);
    assert.match(restored.window.document.querySelector("#editor-status")!.textContent!, /stale/i);
    restored.window.close();
  });

  it("labels CodeMirror content and warns/disables save immediately for mixed line endings", () => {
    const { window, click } = openEditor({ source: "one\r\ntwo\nthree\r\n" });
    click("#edit-markdown");
    assert.equal(window.document.querySelector(".cm-content")!.getAttribute("aria-label"), "Markdown source editor");
    assert.equal(window.document.querySelector("#save-markdown")!.hasAttribute("disabled"), true);
    assert.match(window.document.querySelector("#editor-status")!.textContent!, /mixed line endings/i);
    window.close();
  });

  it("clears server conflict state when Cancel discards edits", () => {
    const { window, click, replace } = openEditor({
      source: "# source\n",
      draft: JSON.stringify({ content: "# stale\n", baseHash: "old-hash" }),
    });
    click("#edit-markdown");
    click("#cancel-markdown");
    assert.equal(window.document.querySelector("#reload-markdown")!.hasAttribute("hidden"), true);
    click("#edit-markdown");
    replace("# fresh edit\n");
    assert.equal(window.document.querySelector("#save-markdown")!.hasAttribute("disabled"), false);
    window.close();
  });
});
