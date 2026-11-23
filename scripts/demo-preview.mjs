// Serves dist-pages/ under the demo base path the way GitHub Pages does: files as they are, a directory's
// index.html (a directory without its trailing slash redirects), and 404.html with status 404 for everything else.
//   DEMO_BASE=/plinth-suite/ PORT=4173 node scripts/demo-preview.mjs      (pnpm demo:preview)
import { createServer } from "node:http";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "dist-pages");
const raw = (process.env.DEMO_BASE ?? "/plinth-suite/").trim() || "/";
const BASE = `/${raw.replace(/^\/+|\/+$/g, "")}/`.replace(/^\/\/$/, "/");
const PORT = Number(process.env.PORT ?? 4173);

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".txt": "text/plain; charset=utf-8",
  ".map": "application/json; charset=utf-8",
};

if (!existsSync(root)) {
  console.error("demo:preview: no dist-pages/. Run pnpm demo:build first.");
  process.exit(1);
}

const send = (res, status, file) => {
  res.writeHead(status, {
    "content-type": TYPES[extname(file)] ?? "application/octet-stream",
    "cache-control": "no-cache",
  });
  res.end(readFileSync(file));
};

createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  const path = decodeURIComponent(url.pathname);
  if (path === "/" && BASE !== "/") {
    res.writeHead(302, { location: BASE });
    res.end();
    return;
  }
  const notFound = () => send(res, 404, join(root, "404.html"));
  if (!path.startsWith(BASE) && `${path}/` !== BASE) return notFound();
  const rel = path.slice(BASE.length - 1) || "/";
  const file = normalize(join(root, rel));
  if (file !== root && !file.startsWith(root + sep)) return notFound();
  if (existsSync(file) && statSync(file).isDirectory()) {
    if (!path.endsWith("/")) {
      res.writeHead(301, { location: `${path}/${url.search}` });
      res.end();
      return;
    }
    const index = join(file, "index.html");
    return existsSync(index) ? send(res, 200, index) : notFound();
  }
  if (existsSync(file)) return send(res, 200, file);
  return notFound();
}).listen(PORT, () => {
  console.log(`demo:preview: http://localhost:${PORT}${BASE}  (town: http://localhost:${PORT}${BASE}town/)`);
});
