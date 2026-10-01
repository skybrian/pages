# Pages

One-off pages and charts for https://pages.skybrian.com.

## Local development

Requires Node.js 22 or newer.

```sh
npm ci
npm run dev
```

Open the local URL printed by Eleventy. `npm run build` generates `_site/`.

## Add a page

Create `src/pages/my-chart.md`:

```md
---
title: My chart
date: 2026-10-01
description: A brief summary for the home page.
---

Write the explanation here, then embed an SVG or other HTML.
```

The page is published at `/my-chart/` and automatically listed on the home
page, newest first. Use unique filenames and an explicit date. The shared
layout supplies the heading, so start the body with prose or a second-level
heading. Description is optional.

Inline SVG is supported. Wrap charts in `<figure>` and include an SVG
`viewBox`, accessible `<title>`/`<desc>`, and optional `<figcaption>`.
Keep the HTML block together without blank lines, then leave a blank line
before returning to Markdown. See `examples/example-chart.md`; copy it
into `src/pages/` to try it. Examples are not published by default.

Markdown and HTML bodies are not processed as Liquid or Nunjucks templates,
so chart scripts and text containing `{{ ... }}` stay literal. Front matter
and shared Nunjucks layouts still work. For a complete standalone HTML page,
use `src/pages/my-page.html` with front matter containing `title`, `date`,
and `layout: false`.

Put separate images, SVG files, or scripts in `src/assets/` and reference
them at `/assets/filename`. Assets are copied unchanged.

## Netlify

Import `skybrian/pages` into Netlify and select the `main` production branch.
The checked-in `netlify.toml` specifies Node 22, `npm run build`, and `_site`
as the publish directory. Netlify installs dependencies before building.

Add `pages.skybrian.com` as a custom domain in Netlify, then create the CNAME
record Netlify specifies with your DNS provider. The repository configuration
does not create the Netlify site or change DNS. Once connected, pushes to
`main` trigger deployments.
