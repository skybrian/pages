import { basicSetup } from "codemirror";
import { markdown } from "@codemirror/lang-markdown";
import { searchKeymap, search, highlightSelectionMatches } from "@codemirror/search";
import { history, historyKeymap } from "@codemirror/commands";
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
  return new TextDecoder().decode(bytes);
};
const source = decodeSource();
let saved = source;
let conflict = false;
const status = document.querySelector<HTMLElement>("#editor-status");
const saveButton = document.querySelector<HTMLButtonElement>("#save-markdown");
const cancelButton = document.querySelector<HTMLButtonElement>("#cancel-markdown");
const reloadButton = document.querySelector<HTMLButtonElement>("#reload-markdown");
let editor: EditorView | undefined;

const setStatus = (text: string) => { if (status) status.textContent = text; };
const dirty = () => !!editor && editor.state.doc.toString() !== saved;
const persistDraft = () => {
  try {
    if (dirty()) sessionStorage.setItem(draftKey, editor!.state.doc.toString());
    else sessionStorage.removeItem(draftKey);
  } catch { /* Storage can be disabled; the unload warning still protects edits. */ }
};
const save = async () => {
  if (!editor || !dirty() || conflict) return;
  saveButton && (saveButton.disabled = true);
  setStatus("Saving…");
  try {
    const response = await fetch(location.pathname, {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json", "x-pages-csrf-token": token },
      body: JSON.stringify({ content: editor.state.doc.toString(), hash }),
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
    saved = editor.state.doc.toString();
    persistDraft();
    setStatus("Saved.");
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "Save failed.");
  } finally {
    if (saveButton) saveButton.disabled = false;
  }
};

button?.addEventListener("click", () => {
  if (!panel || !host) return;
  panel.hidden = false;
  button.hidden = true;
  document.querySelector("pre")?.setAttribute("hidden", "");
  let initial = source;
  try {
    const draft = sessionStorage.getItem(draftKey);
    if (draft !== null && draft !== source) {
      initial = draft;
      setStatus("Restored unsaved edits from this tab. Save to keep them; cancel to discard.");
    }
  } catch { /* Continue with disk contents. */ }
  editor ??= new EditorView({
    parent: host,
    doc: initial,
    extensions: [
      basicSetup, markdown(), history(), search(), highlightSelectionMatches(),
      EditorView.lineWrapping, keymap.of([...historyKeymap, ...searchKeymap]),
      EditorView.theme({
        "&": { border: "1px solid #8c959f", borderRadius: "6px", fontSize: "14px" },
        ".cm-content": { minHeight: "55vh", fontFamily: "ui-monospace,SFMono-Regular,Consolas,monospace" },
        ".cm-scroller": { overflow: "auto" },
      }),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          persistDraft();
          if (!conflict) setStatus(dirty() ? "Unsaved changes" : "Saved.");
        }
      }),
    ],
  });
  editor.focus();
});

saveButton?.addEventListener("click", () => void save());
cancelButton?.addEventListener("click", () => {
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
  try { sessionStorage.removeItem(draftKey); } catch { /* ignore */ }
  location.reload();
});
document.addEventListener("keydown", (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s" && editor) {
    event.preventDefault();
    void save();
  }
});
window.addEventListener("beforeunload", (event) => {
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

