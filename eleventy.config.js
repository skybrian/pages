export default function (eleventyConfig) {
  eleventyConfig.addPassthroughCopy({ "src/assets": "assets" });
  eleventyConfig.addFilter("isoDate", (date) => date.toISOString().slice(0, 10));

  return {
    dir: { input: "src", output: "_site" },
    templateFormats: ["md", "njk", "html"],
    // Leave chart code and template-like text in Markdown/HTML untouched.
    markdownTemplateEngine: false,
    htmlTemplateEngine: false,
  };
}
