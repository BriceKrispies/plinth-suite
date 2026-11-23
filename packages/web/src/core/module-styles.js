// Module CSS: every `src/shell/*.css` and `src/widgets/<domain>/*.css` is injected into layer(modules).
// Found with import.meta.glob, so a package that has no stylesheet yet costs nothing.
const files = import.meta.glob(["../shell/*.css", "../widgets/*/*.css"], {
  query: "?inline",
  import: "default",
  eager: true,
});

const text = Object.entries(files)
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([path, css]) => `/* ${path} */\n${css}`)
  .join("\n");

if (text.trim()) {
  const style = document.createElement("style");
  style.id = "module-styles";
  style.textContent = `@layer modules {\n${text}\n}`;
  document.head.append(style);
}
