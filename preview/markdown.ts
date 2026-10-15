import MarkdownIt, { type Token } from "markdown-it";

const markdown = new MarkdownIt({
  html: false,
  linkify: false,
  typographer: false,
});

function headingText(token: Token): string {
  return (token.children ?? []).map((child) => {
    if (child.type === "text" || child.type === "code_inline") return child.content;
    if (child.type === "image") return child.attrs?.find(([name]) => name === "alt")?.[1] ?? "";
    return "";
  }).join("");
}

function headingSlug(text: string): string {
  const slug = text.normalize("NFKD").toLowerCase()
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^\p{Letter}\p{Number}\s-]/gu, "")
    .trim()
    .replace(/[\s-]+/gu, "-");
  return `markdown-heading-${slug || "section"}`;
}

function localMarkdownFragment(href: string): string | undefined {
  const match = /^(?![a-z][a-z\d+.-]*:|\/)([^?#]+\.(?:md|markdown))#([^?#]+)$/iu.exec(href);
  if (!match) return undefined;
  try {
    return `${match[1]}#${headingSlug(decodeURIComponent(match[2]!))}`;
  } catch {
    return undefined;
  }
}

markdown.core.ruler.after("inline", "preview_heading_ids", (state) => {
  const used = new Set<string>();
  const firstIdBySlug = new Map<string, string>();

  // Allocate every ID before rewriting links so fragment links can target
  // namespaced headings and collisions never steal IDs from the file UI.
  for (let i = 0; i < state.tokens.length; i++) {
    const token = state.tokens[i]!;
    if (token.type !== "heading_open") continue;
    const inline = state.tokens[i + 1];
    if (inline?.type !== "inline") continue;
    const slug = headingSlug(headingText(inline));
    let id = slug;
    let suffix = 1;
    while (used.has(id)) id = `${slug}-${suffix++}`;
    used.add(id);
    if (!firstIdBySlug.has(slug)) firstIdBySlug.set(slug, id);
    token.attrSet("id", id);
  }

  for (const inline of state.tokens) {
    if (inline.type !== "inline") continue;
    for (const child of inline.children ?? []) {
      if (child.type !== "link_open") continue;
      const href = child.attrGet("href");
      if (!href) continue;
      const localTarget = localMarkdownFragment(href);
      if (localTarget) {
        child.attrSet("href", localTarget);
        continue;
      }
      if (!href.startsWith("#")) continue;
      let fragment: string;
      try {
        fragment = decodeURIComponent(href.slice(1));
      } catch {
        continue;
      }
      const target = firstIdBySlug.get(headingSlug(fragment));
      if (target) child.attrSet("href", `#${target}`);
    }
  }
});

function withoutFrontMatter(source: string): string {
  const normalized = source.replace(/^\uFEFF/u, "");
  const opening = /^---[ \t]*(?:\r?\n|$)/u.exec(normalized);
  if (!opening) return normalized;

  const bodyStart = opening[0].length;
  const closing = /^(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/gmu;
  closing.lastIndex = bodyStart;
  const match = closing.exec(normalized);
  if (!match) return normalized;
  return normalized.slice(match.index + match[0].length);
}

/**
 * Render Markdown for the preview file browser.
 *
 * Raw HTML is deliberately disabled. markdown-it also rejects dangerous URL
 * schemes by default, while relative links and images remain relative to the
 * current file-browser URL.
 */
export function renderMarkdown(source: string): string {
  return markdown.render(withoutFrontMatter(source));
}
