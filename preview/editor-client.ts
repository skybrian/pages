import { basicSetup } from "codemirror";
import { markdown } from "@codemirror/lang-markdown";
import { searchKeymap, search, highlightSelectionMatches } from "@codemirror/search";
import { history, historyKeymap } from "@codemirror/commands";
import { EditorState } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";

type FileSnapshot = {
  content: string;
  hash: string;
  renderedHtml?: string;
  diff?: string;
  canRevert?: boolean;
  gitStatus?: "tracked" | "untracked" | "unavailable" | string;
  message?: string;
};

type Tab = "rendered" | "source" | "editor" | "changes";
const tabs: Tab[] = ["rendered", "source", "editor", "changes"];
const tabButtons = new Map(tabs.map((tab) => [
  tab,
  document.querySelector<HTMLButtonElement>(`#file-tab-${tab}`),
]));
const panels = new Map(tabs.map((tab) => [
  tab,
  document.querySelector<HTMLElement>(`#file-panel-${tab}`),
]));
const wrapper = document.querySelector<HTMLElement>("#markdown-editor");
const host = document.querySelector<HTMLElement>("#editor-host");
const editToken = document.querySelector<HTMLMetaElement>('meta[name="pages-edit-token"]')?.content ?? "";
const initialHash = document.querySelector<HTMLMetaElement>('meta[name="pages-source-hash"]')?.content ?? "";
const draftKey = `pages-markdown-draft:${location.pathname}`;
const status = document.querySelector<HTMLElement>("#editor-status");
const reloadButton = document.querySelector<HTMLButtonElement>("#reload-markdown");
const revertButton = document.querySelector<HTMLButtonElement>("#revert-to-head");
const changesStatus = document.querySelector<HTMLElement>("#file-changes-status");
const viewStatus = document.querySelector<HTMLElement>("#file-view-status");
const sourceCode = document.querySelector<HTMLElement>("#file-source-code");
const changesDiff = document.querySelector<HTMLElement>("#file-changes-diff");
const renderedContent = document.querySelector<HTMLElement>("#file-rendered-content");
const sourceEncoded = wrapper?.dataset.source ?? "";
const decodeSource = (encoded: string) => {
  const bytes = Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0));
  return new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes);
};
let source = decodeSource(sourceEncoded);
let diskHash = initialHash;
let draftBaseHash = initialHash;
let editor: EditorView | undefined;
let activeTab: Tab = "rendered";
let snapshot: FileSnapshot | undefined;
let timer: ReturnType<typeof setTimeout> | undefined;
let inFlight: Promise<void> | undefined;
let conflict = false;
let failed = false;
let discardBeforeUnload = false;
let hasMixedLineEndings = /(?<!\r)\n/u.test(source) && source.includes("\r\n")
  || /(^|[^\r])\r(?!\n)/u.test(source);

const setStatus = (text: string) => { if (status) status.textContent = text; };
const text = () => editor?.state.sliceDoc() ?? source;
const dirty = () => !!editor && text() !== source;
const persistDraft = () => {
  try {
    if (dirty() && (failed || conflict)) {
      sessionStorage.setItem(draftKey, JSON.stringify({ content: text(), baseHash: draftBaseHash }));
    } else if (!dirty()) sessionStorage.removeItem(draftKey);
  } catch { /* The unload warning remains if storage is unavailable. */ }
};

async function getSnapshot(): Promise<FileSnapshot> {
  const response = await fetch(`${location.pathname}?format=json`, {
    method: "GET",
    credentials: "same-origin",
    headers: { accept: "application/json" },
  });
  if (!response.ok) throw new Error(`Could not refresh file (${response.status})`);
  const result = await response.json() as Partial<FileSnapshot>;
  if (typeof result.content !== "string" || typeof result.hash !== "string") {
    throw new Error("The file response was invalid.");
  }
  return result as FileSnapshot;
}

function applySnapshot(result: FileSnapshot): void {
  snapshot = result;
  source = result.content;
  diskHash = result.hash;
  hasMixedLineEndings = /(?<!\r)\n/u.test(source) && source.includes("\r\n")
    || /(^|[^\r])\r(?!\n)/u.test(source);
  const encoded = btoa(Array.from(new TextEncoder().encode(source), (byte) => String.fromCharCode(byte)).join(""));
  if (wrapper) wrapper.dataset.source = encoded;
  if (sourceCode) sourceCode.textContent = source;
  if (renderedContent && typeof result.renderedHtml === "string") renderedContent.innerHTML = result.renderedHtml;
  if (changesDiff) changesDiff.textContent = result.diff ?? "";
  if (changesDiff) changesDiff.hidden = false;
  if (revertButton) {
    revertButton.hidden = result.gitStatus !== "tracked";
    revertButton.disabled = result.canRevert !== true;
  }
  if (changesStatus) {
    changesStatus.textContent = result.gitStatus === "tracked"
      ? (result.diff ? "Changes compared with HEAD." : "No changes compared with HEAD.")
      : result.message ?? (result.gitStatus === "untracked"
        ? "File is not present in Git HEAD."
        : "Git HEAD is unavailable.");
  }
  document.dispatchEvent(new Event("syntax-highlight"));
}

function createEditor(initial: string): void {
  if (!host || editor) return;
  editor = new EditorView({
    parent: host,
    doc: initial,
    extensions: [
      basicSetup, markdown(), history(), search(), highlightSelectionMatches(),
      EditorState.lineSeparator.of(source.includes("\r\n") ? "\r\n" : "\n"),
      EditorView.contentAttributes.of({ "aria-label": "Markdown source editor" }),
      EditorView.lineWrapping, keymap.of([...historyKeymap, ...searchKeymap]),
      EditorView.theme({
        "&": { border: "1px solid #8c959f", borderRadius: "6px", fontSize: "14px" },
        ".cm-content": { minHeight: "55vh", fontFamily: "ui-monospace,SFMono-Regular,Consolas,monospace" },
        ".cm-scroller": { overflow: "auto" },
      }),
      EditorView.updateListener.of((update) => {
        if (!update.docChanged) return;
        persistDraft();
        if (conflict) setStatus("The file changed on disk. Your edits are preserved; reload to discard them.");
        else if (failed) setStatus("Autosave failed. Your edits are preserved; retry by switching tabs.");
        else if (hasMixedLineEndings) setStatus("Mixed line endings are preserved; normalize them outside this editor before saving.");
        else {
          setStatus(dirty() ? "Unsaved changes" : "Saved.");
          if (dirty()) scheduleSave();
        }
      }),
    ],
  });
}

async function performSave(): Promise<void> {
  if (!dirty() || conflict) return;
  if (hasMixedLineEndings) throw new Error("Mixed line endings cannot be saved safely.");
  const content = text();
  setStatus("Saving…");
  const response = await fetch(location.pathname, {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json", "x-pages-csrf-token": editToken },
    body: JSON.stringify({ content, hash: diskHash }),
  });
  if (response.status === 409) {
    conflict = true;
    failed = true;
    if (reloadButton) reloadButton.hidden = false;
    persistDraft();
    throw new Error("The file changed on disk. Your edits are preserved; reload to discard them.");
  }
  if (!response.ok) throw new Error(`Autosave failed (${response.status}).`);
  const result = await response.json() as { hash?: unknown };
  if (typeof result.hash !== "string") throw new Error("The save response was invalid.");
  source = content;
  diskHash = result.hash;
  draftBaseHash = result.hash;
  failed = false;
  if (reloadButton) reloadButton.hidden = true;
  persistDraft();
  if (sourceCode) sourceCode.textContent = source;
  if (dirty()) {
    setStatus("Saved submitted version; newer edits are still unsaved.");
    scheduleSave();
  } else {
    setStatus("Saved.");
  }
}

function scheduleSave(): void {
  if (timer) clearTimeout(timer);
  if (!conflict && !hasMixedLineEndings) timer = setTimeout(() => {
    timer = undefined;
    void startSave().catch(() => {});
  }, 500);
}

function startSave(): Promise<void> {
  if (inFlight) return inFlight;
  if (timer) {
    clearTimeout(timer);
    timer = undefined;
  }
  if (!dirty() || conflict) return Promise.resolve();
  const task = performSave().catch((error: unknown) => {
    failed = true;
    persistDraft();
    setStatus(error instanceof Error ? error.message : "Autosave failed.");
    throw error;
  }).finally(() => {
    if (inFlight === task) inFlight = undefined;
  });
  inFlight = task;
  return task;
}

async function flushSaves(): Promise<void> {
  if (timer) {
    clearTimeout(timer);
    timer = undefined;
  }
  if (inFlight) await inFlight;
  while (dirty()) {
    await startSave();
    if (failed || conflict) throw new Error("Autosave did not complete.");
  }
}

async function enterEditor(fresh: FileSnapshot): Promise<void> {
  // Always base a newly entered editor on a fresh read, not the page-load copy.
  applySnapshot(fresh);
  draftBaseHash = diskHash;
  conflict = false;
  failed = false;
  if (reloadButton) reloadButton.hidden = true;
  setStatus("Saved.");
  let initial = source;
  try {
    const raw = sessionStorage.getItem(draftKey);
    if (raw) {
      const parsed = JSON.parse(raw) as { content?: unknown; baseHash?: unknown };
      if (typeof parsed.content === "string" && parsed.content !== source) {
        initial = parsed.content;
        draftBaseHash = typeof parsed.baseHash === "string" ? parsed.baseHash : "";
        if (typeof parsed.baseHash !== "string" || parsed.baseHash !== diskHash) {
          conflict = true;
          failed = true;
          if (reloadButton) reloadButton.hidden = false;
          setStatus("Restored edits are based on an older file version and cannot be autosaved.");
        } else {
          failed = true;
          setStatus("Restored edits from this tab; autosaving shortly.");
        }
      } else sessionStorage.removeItem(draftKey);
    }
  } catch { /* Start from the fresh disk contents if session storage is unavailable. */ }
  createEditor(initial);
  if (dirty() && !conflict) scheduleSave();
  if (hasMixedLineEndings) setStatus("This file has mixed line endings. Autosave is disabled to preserve them.");
}

let transitionQueue = Promise.resolve();
function enqueueTransition(action: () => Promise<void>): Promise<void> {
  const transition = transitionQueue.then(action);
  transitionQueue = transition.catch(() => {});
  return transition;
}
function showTab(tab: Tab): Promise<void> {
  return enqueueTransition(() => showTabNow(tab));
}

async function showTabNow(tab: Tab): Promise<void> {
  if (!tabButtons.get(tab) || !panels.get(tab) || tab === activeTab) return;
  if (activeTab === "editor") {
    try { await flushSaves(); }
    catch {
      editor?.focus();
      return;
    }
  }
  // Fetch before changing visibility or destroying CodeMirror. Typing can
  // continue during the read, so repeat the flush/read pair until the editor
  // remains clean across the read. No event can interleave after that check
  // and the synchronous destroy below.
  let fresh: FileSnapshot;
  try {
    while (true) {
      if (activeTab === "editor") await flushSaves();
      fresh = await getSnapshot();
      if (activeTab !== "editor" || (!dirty() && !inFlight)) break;
    }
  }
  catch (error) {
    const message = error instanceof Error ? error.message : "Could not load the file.";
    if (activeTab === "editor") setStatus(message);
    else if (viewStatus) viewStatus.textContent = message;
    if (tab === "changes" && changesStatus) changesStatus.textContent = message;
    return;
  }
  if (tab === "editor") {
    if (activeTab === "editor") {
      editor?.destroy();
      editor = undefined;
    }
    await enterEditor(fresh);
  } else {
    if (activeTab === "editor") {
      editor?.destroy();
      editor = undefined;
    }
    applySnapshot(fresh);
  }
  activeTab = tab;
  for (const name of tabs) {
    const button = tabButtons.get(name);
    const panel = panels.get(name);
    const selected = name === tab;
    if (button) {
      button.setAttribute("aria-selected", String(selected));
      button.tabIndex = selected ? 0 : -1;
    }
    if (panel) panel.hidden = !selected;
  }
  if (wrapper) wrapper.hidden = tab !== "editor";
  if (tab === "editor") {
    editor?.requestMeasure();
    editor?.focus();
  }
  if (viewStatus) viewStatus.textContent = snapshot?.message ?? "";
}

for (const tab of tabs) {
  tabButtons.get(tab)?.addEventListener("click", () => { void showTab(tab); });
  tabButtons.get(tab)?.addEventListener("keydown", (event) => {
    const keyboard = event as KeyboardEvent;
    let index = tabs.indexOf(tab);
    if (keyboard.key === "ArrowRight" || keyboard.key === "ArrowDown") index = (index + 1) % tabs.length;
    else if (keyboard.key === "ArrowLeft" || keyboard.key === "ArrowUp") index = (index - 1 + tabs.length) % tabs.length;
    else if (keyboard.key === "Home") index = 0;
    else if (keyboard.key === "End") index = tabs.length - 1;
    else return;
    keyboard.preventDefault();
    const target = tabs[index]!;
    tabButtons.get(target)?.focus();
    void showTab(target);
  });
}

async function revertToHead(): Promise<void> {
  if (activeTab !== "changes" || !revertButton || revertButton.disabled
    || !window.confirm("Revert this file to HEAD? This does not change the Git index.")) return;
  revertButton.disabled = true;
  if (changesStatus) changesStatus.textContent = "Reverting…";
  try {
    const response = await fetch(location.pathname, {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json", "x-pages-csrf-token": editToken },
      body: JSON.stringify({ action: "revert", hash: snapshot?.hash ?? diskHash }),
    });
    if (response.status === 409) throw new Error("The file changed on disk; refresh Changes before reverting.");
    if (!response.ok) throw new Error(`Revert failed (${response.status}).`);
    applySnapshot(await response.json() as FileSnapshot);
    setStatus("Reverted to HEAD.");
    if (changesStatus && !snapshot?.message) changesStatus.textContent = "Reverted to HEAD.";
  } catch (error) {
    if (changesStatus) changesStatus.textContent = error instanceof Error ? error.message : "Revert failed.";
    revertButton.disabled = false;
  }
}
revertButton?.addEventListener("click", () => {
  void enqueueTransition(revertToHead);
});

reloadButton?.addEventListener("click", () => {
  if (!window.confirm("Discard the preserved edits and reload the file from disk?")) return;
  discardBeforeUnload = true;
  try { sessionStorage.removeItem(draftKey); } catch { /* ignore */ }
  location.reload();
});

document.addEventListener("keydown", (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s" && activeTab === "editor") {
    event.preventDefault();
    void startSave().catch(() => {});
  }
});
window.addEventListener("beforeunload", (event) => {
  if (discardBeforeUnload) return;
  if (dirty() || inFlight) {
    // If a request may have committed an earlier snapshot, the editor text
    // and this baseline hash deliberately restore as stale rather than
    // risk replacing that committed snapshot after reload.
    try { sessionStorage.setItem(draftKey, JSON.stringify({ content: text(), baseHash: draftBaseHash })); }
    catch { /* Storage may be disabled. */ }
    event.preventDefault();
    event.returnValue = "";
  }
});
document.addEventListener("click", (event) => {
  const link = (event.target as Element | null)?.closest("a");
  if ((dirty() || inFlight) && link && !window.confirm("Leave this page while edits are still being saved?")) {
    event.preventDefault();
  }
});
