export default {
  layout: "base.njk",
  tags: "pages",
  eleventyComputed: {
    permalink: ({ page }) => `/${page.fileSlug}/`,
  },
};
