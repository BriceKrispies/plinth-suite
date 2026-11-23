// Builds the static GitHub Pages demo into dist-pages/ (no backend: recorded data, simulated writes).
//   DEMO_BASE=/plinth-suite/ node scripts/demo-build.mjs        (pnpm demo:build)
// Classic (packages/web) at <base>, Township (packages/town-spike) at <base>town/, the recordings at
// <base>demo-data/, a 404.html that sends deep links to the right app, and .nojekyll.
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const raw = (process.env.DEMO_BASE ?? "/plinth-suite/").trim() || "/";
const BASE = `/${raw.replace(/^\/+|\/+$/g, "")}/`.replace(/^\/\/$/, "/");
const out = join(root, "dist-pages");
const recordings = join(root, "packages", "demo-data", "recordings");

const fail = (message) => {
  console.error(`demo:build: ${message}`);
  process.exit(1);
};

const recorded = existsSync(recordings) ? readdirSync(recordings).filter((f) => f.endsWith(".json")) : [];
if (!recorded.includes("manifest.json") && process.env.DEMO_ALLOW_EMPTY !== "1")
  fail(
    "no recordings in packages/demo-data/recordings. Record them against the local stack first " +
      "(pnpm demo:record), or set DEMO_ALLOW_EMPTY=1 to build without data.",
  );

const pnpm = (args) => {
  console.log(`> pnpm ${args.join(" ")}`);
  const run = spawnSync("pnpm", args, { cwd: root, stdio: "inherit", shell: process.platform === "win32" });
  if (run.status !== 0) fail(`pnpm ${args.join(" ")} exited with ${run.status}`);
};

const build = (pkg, base) =>
  pnpm([
    "--filter",
    pkg,
    "exec",
    "vite",
    "build",
    "--mode",
    "demo",
    "--base",
    base,
    "--outDir",
    "dist-demo",
    "--emptyOutDir",
  ]);

build("@plinth/web", BASE);
build("@plinth/town-spike", `${BASE}town/`);

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
cpSync(join(root, "packages", "web", "dist-demo"), out, { recursive: true });
cpSync(join(root, "packages", "town-spike", "dist-demo"), join(out, "town"), { recursive: true });
mkdirSync(join(out, "demo-data"), { recursive: true });
for (const f of recorded) cpSync(join(recordings, f), join(out, "demo-data", f));

// GitHub Pages serves 404.html for any path it has no file for. Keep the requested URL and hand it to the app that
// owns the prefix; that app's index.html puts it back with history.replaceState before anything else runs.
writeFileSync(
  join(out, "404.html"),
  `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Plinth Suite</title>
    <script>
      (function () {
        var base = ${JSON.stringify(BASE)};
        var town = base + "town";
        var p = location.pathname;
        try {
          sessionStorage.setItem("plinth-spa-redirect", location.href);
        } catch (e) {}
        location.replace(p === town || p.indexOf(town + "/") === 0 ? town + "/" : base);
      })();
    </script>
  </head>
  <body></body>
</html>
`,
);
writeFileSync(join(out, ".nojekyll"), "");

const size = (dir) =>
  readdirSync(dir, { withFileTypes: true }).reduce(
    (n, e) => n + (e.isDirectory() ? size(join(dir, e.name)) : statSync(join(dir, e.name)).size),
    0,
  );
console.log(
  `demo:build: dist-pages/ for base ${BASE}: ${(size(out) / 1024 / 1024).toFixed(2)} MB ` +
    `(${recorded.length} recording files)`,
);
