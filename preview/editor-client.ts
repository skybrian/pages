import { basicSetup } from "codemirror";
import { markdown } from "@codemirror/lang-markdown";
import { searchKeymap, search, highlightSelectionMatches } from "@codemirror/search";
import { history, historyKeymap } from "@codemirror/commands";
import { EditorView, keymap } from "@codemirror/view";

const button = document.querySelector<HTMLButtonElement>("#edit-markdown");
const panel = document.querySelector<HTMLElement>("#markdown-editor");
const host = document.querySelector<HTMLElement>("#editor-host");
const source = document.querySelector("pre code")?.textContent ?? "";
let editor: EditorView | undefined;

button?.addEventListener("click", () => {
  if (!panel || !host) return;
  panel.hidden = false;
  button.hidden = true;
  document.querySelector("pre")?.setAttribute("hidden", "");
  editor ??= new EditorView({
    parent: host,
    doc: source,
    extensions: [
      basicSetup, markdown(), history(), search(), highlightSelectionMatches(),
      EditorView.lineWrapping, keymap.of([...historyKeymap, ...searchKeymap]),
      EditorView.theme({
        "&": { border: "1px solid #8c959f", borderRadius: "6px", fontSize: "14px" },
        ".cm-content": { minHeight: "55vh", fontFamily: "ui-monospace,SFMono-Regular,Consolas,monospace" },
        ".cm-scroller": { overflow: "auto" },
      }),
    ],
  });
  editor.focus();
});

