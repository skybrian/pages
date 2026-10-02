export default {
  layout: "base.njk",
  tags: "pages",
  eleventyComputed: {
    /** @param {{ page: { filePathStem: string } }} data */
    permalink: ({ page }) =>
      `${page.filePathStem.replace(/^\/pages\//, "/").replace(/\/index$/, "")}/`,
  },
};
