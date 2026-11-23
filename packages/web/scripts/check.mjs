// Syntax-checks every browser module with `node --check`, and confirms that each relative import
// in them resolves to a file. The client is plain ES modules with no build step to catch either.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "src");

const walk = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name)) : e.name.endsWith(".js") ? [join(dir, e.name)] : [],
  );

let failed = 0;
for (const file of walk(root)) {
  const run = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
  if (run.status !== 0) {
    failed += 1;
    console.error(run.stderr);
  }
  const text = readFileSync(file, "utf8");
  for (const m of text.matchAll(/from\s+"(\.[^"]+)"/g)) {
    if (!existsSync(resolve(dirname(file), m[1]))) {
      failed += 1;
      console.error(`${file}: unresolved import ${m[1]}`);
    }
  }
}

// ---- design-system rules (DESIGN-SYSTEM section 12) ----
const walkAll = (dir, ext) =>
  existsSync(dir)
    ? readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory() ? walkAll(join(dir, e.name), ext) : e.name.endsWith(ext) ? [join(dir, e.name)] : [],
      )
    : [];
const fail = (message) => {
  failed += 1;
  console.error(message);
};

// Item 6: every ICON_NAMES entry has a path, and every icon name used by a module is in ICON_NAMES.
const spec = resolve(root, "..", "..", "spec", "src", "suite", "primitives.ts");
if (existsSync(spec)) {
  const block = /export const ICON_NAMES = \[([\s\S]*?)\] as const/.exec(readFileSync(spec, "utf8"));
  const names = new Set([...(block?.[1] ?? "").matchAll(/"([a-z-]+)"/g)].map((m) => m[1]));
  const iconsSrc = readFileSync(resolve(root, "ds", "js", "icons.js"), "utf8");
  const drawn = new Set([...iconsSrc.matchAll(/^ {2}(?:"([a-z-]+)"|([a-z]+)):/gm)].map((m) => m[1] ?? m[2]));
  for (const n of names) if (!drawn.has(n)) fail(`icons.js: no path for ICON_NAMES entry "${n}"`);
  for (const n of drawn) if (!names.has(n)) fail(`icons.js: "${n}" is not in ICON_NAMES`);
  const ownedDirs = ["ds", "core", "app", "shell", "widgets"].map((d) => resolve(root, d));
  for (const dir of ownedDirs)
    for (const file of walkAll(dir, ".js")) {
      const text = readFileSync(file, "utf8");
      const used = [
        ...text.matchAll(/icon\(\s*"([a-z-]+)"/g),
        ...text.matchAll(/icon:\s*"([a-z-]+)"/g),
        ...text.matchAll(/icon\s*=\s*"([a-z-]+)"/g),
      ];
      for (const m of used) if (!names.has(m[1])) fail(`${file}: icon "${m[1]}" is not in ICON_NAMES`);
    }
}

// Item 12: no innerHTML, outerHTML or insertAdjacentHTML in the design system, core, app, shell or widgets.
for (const dir of ["ds", "core", "app", "shell", "widgets"]) {
  for (const file of walkAll(resolve(root, dir), ".js")) {
    const text = readFileSync(file, "utf8");
    if (/(innerHTML|outerHTML|insertAdjacentHTML)/.test(text))
      fail(`${file}: assigns or calls an HTML-string API`);
  }
}

// Items 7, 10 and 11: tokens are defined once, every var() resolves, !important only in overrides.css.
const tokensFile = resolve(root, "ds", "css", "tokens.css");
const defined = new Set(
  [...readFileSync(tokensFile, "utf8").matchAll(/^\s*(--[a-z0-9-]+):/gm)].map((m) => m[1]),
);
// Looks (ds/css/looks/*.css, html[data-look]) may define and override tokens and component hooks; every hook a
// component reads carries a fallback, so the Meridian look needs no declaration of its own.
const looksDir = resolve(root, "ds", "css", "looks");
for (const file of walkAll(looksDir, ".css"))
  for (const m of readFileSync(file, "utf8").matchAll(/^\s*(--[a-z0-9-]+)\s*:/gm)) defined.add(m[1]);
const local = /^--(_|m-|w-[a-z]+-|art-|x$|y$|w$|h$|x6$|w6$)/;
const cssDirs = ["ds/css", "shell", "widgets", "app"].map((d) => resolve(root, d));
for (const dir of cssDirs)
  for (const file of walkAll(dir, ".css")) {
    const text = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    for (const m of text.matchAll(/var\((--[a-z0-9-]+)/g))
      if (!defined.has(m[1]) && !local.test(m[1])) fail(`${file}: var(${m[1]}) is not a token`);
    if (!file.endsWith("overrides.css") && /!important/.test(text))
      fail(`${file}: !important outside overrides.css`);
    if (file !== tokensFile && !file.endsWith("overrides.css") && !file.startsWith(looksDir))
      for (const m of text.matchAll(/^\s*(--[a-z0-9-]+)\s*:/gm))
        if (!local.test(m[1])) fail(`${file}: defines token ${m[1]} outside tokens.css`);
  }

// The cascade declaration is the first statement of styles.css.
const sheet = readFileSync(resolve(root, "styles.css"), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .trim();
if (
  !sheet.startsWith("@layer reset, tokens, base, layout, components, looks, modules, utilities, overrides;")
)
  fail("styles.css: the @layer declaration must be the first statement");

if (failed > 0) process.exit(1);
console.log("web: modules ok");
