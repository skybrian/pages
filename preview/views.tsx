import { Fragment, type ComponentChildren } from "preact";
import { renderDocument } from "./render.tsx";

const ASSET_ROUTE = "/admin/assets/microlighter";
const PAGE_STYLES = "body{max-width:72rem;margin:2rem auto;padding:0 1rem;font:16px/1.6 system-ui,sans-serif;color:#24292f}ul{list-style:none;padding-left:0}";
const SOURCE_STYLES = "pre{overflow:auto;padding:1rem;border:1px solid #d0d7de;border-radius:6px;background:#fff}code{font:13px/1.6 ui-monospace,SFMono-Regular,Consolas,monospace;white-space:pre}";

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
}: {
  name: string;
  breadcrumbs: Breadcrumb[];
  language: string;
  source: string;
}) {
  return (
    <PageLayout title={name} sourceView>
      <h1>{name}</h1>
      <Breadcrumbs items={[...breadcrumbs, { label: name }]} />

      <pre><code class={`language-${language}`}>{source}</code></pre>
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
