import { basicSetup } from "codemirror";
import { markdown } from "@codemirror/lang-markdown";
import { searchKeymap, search, highlightSelectionMatches } from "@codemirror/search";
import { history, historyKeymap } from "@codemirror/commands";
import { EditorState } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";

const button = document.querySelector<HTMLButtonElement>("#edit-markdown");
const panel = document.querySelector<HTMLElement>("#markdown-editor");
const host = document.querySelector<HTMLElement>("#editor-host");
const token = document.querySelector<HTMLMetaElement>('meta[name="pages-edit-token"]')?.content ?? "";
let hash = document.querySelector<HTMLMetaElement>('meta[name="pages-source-hash"]')?.content ?? "";
const draftKey = `pages-markdown-draft:${location.pathname}`;
const decodeSource = () => {
  const encoded = panel?.dataset.source ?? "";
  const bytes = Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0));
  return new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes);
};
const encodeSource = (text: string) => {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (let start = 0; start < bytes.length; start += 32_768) {
    binary += String.fromCharCode(...bytes.subarray(start, start + 32_768));
  }
  return btoa(binary);
};
const source = decodeSource();
let saved = source;
let conflict = false;
let saving = false;
let discardDraftForReload = false;
const hasMixedLineEndings = /(?<!\r)\n/u.test(source) && source.includes("\r\n")
  || /(^|[^\r])\r(?!\n)/u.test(source);
const status = document.querySelector<HTMLElement>("#editor-status");
const saveButton = document.querySelector<HTMLButtonElement>("#save-markdown");
const cancelButton = document.querySelector<HTMLButtonElement>("#cancel-markdown");
const reloadButton = document.querySelector<HTMLButtonElement>("#reload-markdown");
let editor: EditorView | undefined;

const setStatus = (text: string) => { if (status) status.textContent = text; };
const lineSeparator = source.includes("\r\n") ? "\r\n" : "\n";
const serialize = () => editor
  ? editor.state.doc.sliceString(0, editor.state.doc.length, editor.state.facet(EditorState.lineSeparator) || lineSeparator)
  : source;
const dirty = () => !!editor && serialize() !== saved;
const persistDraft = () => {
  try {
    if (dirty()) sessionStorage.setItem(draftKey, JSON.stringify({ content: serialize(), baseHash: hash }));
    else sessionStorage.removeItem(draftKey);
  } catch { /* Storage can be disabled; the unload warning still protects edits. */ }
};
const save = async () => {
  if (!editor || !dirty() || conflict || saving) return;
  if (hasMixedLineEndings) {
    setStatus("Mixed line endings are preserved; normalize them outside this editor before saving.");
    return;
  }
  const submittedContent = serialize();
  const submittedHash = hash;
  saving = true;
  if (saveButton) saveButton.disabled = true;
  if (cancelButton) cancelButton.disabled = true;
  setStatus("Saving…");
  try {
    const response = await fetch(location.pathname, {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json", "x-pages-csrf-token": token },
      body: JSON.stringify({ content: submittedContent, hash: submittedHash }),
    });
    if (response.status === 409) {
      conflict = true;
      if (reloadButton) reloadButton.hidden = false;
      setStatus("The file changed on disk. Your edits are preserved; reload to discard them.");
      return;
    }
    if (!response.ok) throw new Error(`Save failed (${response.status})`);
    const result = await response.json() as { hash: string };
    hash = result.hash;
    saved = submittedContent;
    const code = document.querySelector("pre code");
    if (code) code.textContent = submittedContent;
    if (panel) panel.dataset.source = encodeSource(submittedContent);
    persistDraft();
    setStatus(dirty() ? "Saved submitted version; newer edits are still unsaved." : "Saved.");
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "Save failed.");
  } finally {
    saving = false;
    if (saveButton) saveButton.disabled = false;
    if (cancelButton) cancelButton.disabled = false;
  }
};

button?.addEventListener("click", () => {
  if (!panel || !host) return;
  panel.hidden = false;
  button.hidden = true;
  document.querySelector("pre")?.setAttribute("hidden", "");
  let initial = source;
  try {
    const rawDraft = sessionStorage.getItem(draftKey);
    if (rawDraft !== null) {
      let content: string;
      let baseHash: string | undefined;
      try {
        const parsed = JSON.parse(rawDraft) as { content?: unknown; baseHash?: unknown };
        if (typeof parsed.content === "string") {
          content = parsed.content;
          baseHash = typeof parsed.baseHash === "string" ? parsed.baseHash : undefined;
        } else content = rawDraft;
      } catch { content = rawDraft; }
      if (content !== source) {
        initial = content;
        if (!baseHash || baseHash !== hash) {
          conflict = true;
          if (reloadButton) reloadButton.hidden = false;
          setStatus(baseHash
            ? "Restored draft is stale against the current source version. It is preserved but cannot be saved over the newer file."
            : "Restored draft has an unknown base version. It is preserved but cannot be saved until reloaded.");
        } else {
          setStatus("Restored unsaved edits from this tab. Save to keep them; cancel to discard.");
        }
      }
    }
  } catch { /* Continue with disk contents. */ }
  editor ??= new EditorView({
    parent: host,
    doc: initial,
    extensions: [
      basicSetup, markdown(), history(), search(), highlightSelectionMatches(),
      EditorState.lineSeparator.of(source.includes("\r\n") ? "\r\n" : "\n"),
      EditorView.lineWrapping, keymap.of([...historyKeymap, ...searchKeymap]),
      EditorView.theme({
        "&": { border: "1px solid #8c959f", borderRadius: "6px", fontSize: "14px" },
        ".cm-content": { minHeight: "55vh", fontFamily: "ui-monospace,SFMono-Regular,Consolas,monospace" },
        ".cm-scroller": { overflow: "auto" },
      }),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          persistDraft();
          if (!conflict && !hasMixedLineEndings) setStatus(dirty() ? "Unsaved changes" : "Saved.");
          else if (hasMixedLineEndings) setStatus("Mixed line endings are preserved; saving is disabled to avoid rewriting them.");
        }
      }),
    ],
  });
  editor.focus();
});

saveButton?.addEventListener("click", () => void save());
cancelButton?.addEventListener("click", () => {
  if (saving) return;
  if (dirty() && !window.confirm("Discard your unsaved Markdown edits?")) return;
  try { sessionStorage.removeItem(draftKey); } catch { /* ignore */ }
  if (editor) editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: saved } });
  if (panel) panel.hidden = true;
  if (button) button.hidden = false;
  document.querySelector("pre")?.removeAttribute("hidden");
  setStatus("");
});
reloadButton?.addEventListener("click", () => {
  if (!window.confirm("Discard the preserved edits and reload the file from disk?")) return;
  discardDraftForReload = true;
  try { sessionStorage.removeItem(draftKey); } catch { /* ignore */ }
  location.reload();
});
document.addEventListener("keydown", (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s" && editor) {
    event.preventDefault();
    if (!saving) void save();
  }
});
window.addEventListener("beforeunload", (event) => {
  if (discardDraftForReload) return;
  if (dirty()) {
    persistDraft();
    event.preventDefault();
    event.returnValue = "";
  }
});
document.addEventListener("click", (event) => {
  const link = (event.target as Element | null)?.closest("a");
  if (dirty() && link && !window.confirm("Leave this page with unsaved Markdown edits?")) {
    event.preventDefault();
  }
});

