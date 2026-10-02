import type { ComponentChild } from "preact";
import { renderToString } from "preact-render-to-string";

/** Render a Preact child as a complete HTML document. */
export function renderDocument(child: ComponentChild): string {
  return `<!doctype html>${renderToString(<>{child}</>)}`;
}
