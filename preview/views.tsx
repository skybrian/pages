import { Fragment, type ComponentChildren } from "preact";
import { renderDocument } from "./render.tsx";
import { renderMarkdown } from "./markdown.ts";
import { PREVIEW_RIBBON_STYLES } from "./ribbon.js";

const ASSET_ROUTE = "/admin/assets/microlighter";
const PAGE_STYLES = "body{max-width:72rem;margin:2rem auto;padding:0 1rem;font:16px/1.6 system-ui,sans-serif;color:#24292f}ul{list-style:none;padding-left:0}";
const SOURCE_STYLES = "#file-panel-source pre{padding:1rem;border:1px solid #d0d7de;border-radius:6px;background:#fff;white-space:pre-wrap;overflow-wrap:anywhere}#file-panel-source code{font:13px/1.6 ui-monospace,SFMono-Regular,Consolas,monospace;white-space:inherit}";
const FILE_VIEW_STYLES = "[role=tablist]{display:flex;gap:.25rem;border-bottom:1px solid #d0d7de;margin:1rem 0}[role=tab]{padding:.5rem .8rem;border:1px solid transparent;background:transparent;color:inherit;font:inherit;cursor:pointer}[role=tab][aria-selected=true]{border-color:#d0d7de;border-bottom-color:#fff;border-radius:6px 6px 0 0;margin-bottom:-1px;background:#fff}[role=tabpanel]{min-height:2rem}#file-rendered-content{overflow-wrap:anywhere}#file-rendered-content ul{list-style:disc;padding-left:2em}#file-rendered-content ul ul{list-style:circle}#file-rendered-content ol{list-style:decimal;padding-left:2em}#file-rendered-content li{margin:.2em 0}#file-rendered-content pre{padding:1rem;border:1px solid #d0d7de;border-radius:6px;background:#f6f8fa;overflow:auto}#file-rendered-content pre code{font:13px/1.6 ui-monospace,SFMono-Regular,Consolas,monospace;white-space:pre}#file-rendered-content img{max-width:100%;height:auto}#file-changes-diff{overflow:auto}";

export type Breadcrumb = {
  label: string;
  href?: string;
};

export type DirectoryEntry = {
  name: string;
  href?: string;
  target?: "_blank";
};

type PageLayoutProps = {
  title: string;
  children: ComponentChildren;
  sourceView?: boolean;
};

export function PageLayout({ title, children, sourceView = false }: PageLayoutProps) {
  return (
    <html>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <title>{title}</title>
        {sourceView && <link rel="stylesheet" href={`${ASSET_ROUTE}/dist/themes/github.css`} />}
        <style>{PAGE_STYLES + (sourceView ? SOURCE_STYLES : "")}</style>
      </head>
      <body data-syntax-theme={sourceView ? "github" : undefined}>{children}</body>
    </html>
  );
}

export function Breadcrumbs({ items }: { items: Breadcrumb[] }) {
  return (
    <nav>
      {items.map((item, index) => (
        <Fragment key={`${item.href ?? item.label}-${index}`}>
          {index > 0 && " / "}
          {item.href ? <a href={item.href}>{item.label}</a> : item.label}
        </Fragment>
      ))}
    </nav>
  );
}

export function DirectoryListing({
  breadcrumbs,
  parentHref,
  entries,
}: {
  breadcrumbs: Breadcrumb[];
  parentHref?: string;
  entries: DirectoryEntry[];
}) {
  return (
    <PageLayout title="Files">
      <h1>Worktree files</h1>
      <Breadcrumbs items={breadcrumbs} />
      <ul>
        {parentHref && <li><a href={parentHref}>../</a></li>}
        {entries.map((entry) => (
          <li key={entry.href ?? entry.name}>{entry.href ? (
            <a href={entry.href} target={entry.target} rel={entry.target === "_blank" ? "noopener" : undefined}>
              {entry.name}
            </a>
          ) : entry.name}</li>
        ))}
      </ul>
    </PageLayout>
  );
}

export function SourceView({
  name,
  breadcrumbs,
  language,
  source,
  previewUrl,
  editable = false,
  editToken,
  sourceHash,
  sourceEncoded,
  renderedHtml,
  isMarkdown = editable,
}: {
  name: string;
  breadcrumbs: Breadcrumb[];
  language: string;
  source: string;
  previewUrl?: string;
  editable?: boolean;
  editToken?: string;
  sourceHash?: string;
  sourceEncoded?: string;
  renderedHtml?: string;
  isMarkdown?: boolean;
}) {
  const markdownHtml = renderedHtml ?? (isMarkdown ? renderMarkdown(source) : "");
  const defaultTab = isMarkdown ? "rendered" : "source";
  return (
    <PageLayout title={name} sourceView>
      <style>{FILE_VIEW_STYLES}</style>
      {previewUrl && <>
        <a class="preview-ribbon" href={previewUrl} aria-label="Source view: return to preview page">Source</a>
        <style>{PREVIEW_RIBBON_STYLES}</style>
      </>}
      <h1>{name}</h1>
      <Breadcrumbs items={[...breadcrumbs, { label: name }]} />

      <div id="file-viewer">
        <p id="file-view-status" role="status" aria-live="polite" />
        <div role="tablist" aria-label="File view">
          {isMarkdown && <button id="file-tab-rendered" type="button" role="tab" aria-controls="file-panel-rendered" aria-selected={defaultTab === "rendered"} tabIndex={defaultTab === "rendered" ? 0 : -1}>Rendered</button>}
          <button id="file-tab-source" type="button" role="tab" aria-controls="file-panel-source" aria-selected={defaultTab === "source"} tabIndex={defaultTab === "source" ? 0 : -1}>Source</button>
          {editable && <button id="file-tab-editor" type="button" role="tab" aria-controls="file-panel-editor" aria-selected="false" tabIndex={-1}>Editor</button>}
          {isMarkdown && <button id="file-tab-changes" type="button" role="tab" aria-controls="file-panel-changes" aria-selected="false" tabIndex={-1}>Changes</button>}
        </div>
        {isMarkdown && <section id="file-panel-rendered" role="tabpanel" tabIndex={0} aria-labelledby="file-tab-rendered" hidden={defaultTab !== "rendered"}>
          <div id="file-rendered-content" dangerouslySetInnerHTML={{ __html: markdownHtml }} />
        </section>}
        <section id="file-panel-source" role="tabpanel" tabIndex={0} aria-labelledby="file-tab-source" hidden={defaultTab !== "source"}>
          <pre><code id="file-source-code" class={`language-${language}`}>{source}</code></pre>
        </section>
        {editable && <section id="file-panel-editor" role="tabpanel" aria-labelledby="file-tab-editor" hidden>
          <div id="markdown-editor" data-source={sourceEncoded}>
            <div id="editor-host" aria-label="Markdown editor" />
            <p>Changes save automatically. Ctrl/Cmd-S saves immediately. Search with Ctrl/Cmd-F.</p>
            <button id="reload-markdown" type="button" hidden>Reload from disk</button>
            <p id="editor-status" role="status" aria-live="polite"></p>
          </div>
        </section>}
        {isMarkdown && <section id="file-panel-changes" role="tabpanel" tabIndex={0} aria-labelledby="file-tab-changes" hidden>
          <p id="file-changes-status" role="status" aria-live="polite">Changes load when this tab is opened.</p>
          <pre id="file-changes-diff" hidden />
          <button id="revert-to-head" type="button" hidden>Revert to HEAD…</button>
          <p id="revert-status" role="status" aria-live="polite" />
        </section>}
      </div>
      {editable && editToken && <meta name="pages-edit-token" content={editToken} />}
      {editable && sourceHash && <meta name="pages-source-hash" content={sourceHash} />}
      {editable && <script type="module" src="/admin/assets/editor/editor.js" />}
      <script type="module" src={`${ASSET_ROUTE}/dist/microlighter.min.js`} />
    </PageLayout>
  );
}

export function ErrorPage({ status, text }: { status: number; text: string }) {
  return (
    <PageLayout title={`${status}`}>
      <h1>{status}</h1>
      <p>{text}</p>
    </PageLayout>
  );
}

export function renderDirectoryListing(props: Parameters<typeof DirectoryListing>[0]): string {
  return renderDocument(<DirectoryListing {...props} />);
}

export function renderSourceView(props: Parameters<typeof SourceView>[0]): string {
  return renderDocument(<SourceView {...props} />);
}

export function renderErrorPage(status: number, text: string): string {
  return renderDocument(<ErrorPage status={status} text={text} />);
}
