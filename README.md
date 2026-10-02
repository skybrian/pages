# Pages

One-off pages and charts for https://pages.skybrian.com.

## Image posts

Give each post a directory in `src/pages/`, with its image next to `index.md`:

```text
src/pages/my-image-post/
├── index.md
└── example.png
```

Use the `image-post.njk` layout in `index.md` and a relative image path:

```markdown
---
title: An image post
date: 2026-10-02
layout: image-post.njk
image: example.png
imageAlt: "A description of the image."
imageWidth: 880
imageHeight: 1184
---
Your note goes here. Markdown formatting is supported.
```

Use the image's actual dimensions (or omit both dimension fields).
The post appears on the home page automatically. Clicking the image opens
the original file. The directory name determines the page URL (for example,
`/my-image-post/`). Referenced post images are copied alongside the generated
page, while `src/assets/` is reserved for shared site assets such as CSS.
