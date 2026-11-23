import { defineConfig, type Plugin } from "vite";

// The spike is served under /town/ so the classic dev server (5173) can proxy /town to it. Every route under the base
// (`/town/`, `/town/city`, `/town/points`) serves the one page and the client router resolves it. Paths with dots in
// them would otherwise be treated as files, so rewrite any HTML navigation that is not an API, realtime, source or
// Vite internal path (as packages/web/vite.config.ts does, plus the base).
const BASE = "/town/";

const appRoutes = (): Plugin => ({
  name: "plinth-town-routes",
  configureServer(server) {
    server.middlewares.use((req, _res, next) => {
      const url = req.url ?? "";
      const full = url.split("?")[0] ?? "";
      const path = full.startsWith(BASE) ? `/${full.slice(BASE.length)}` : full;
      const internal =
        /^\/(api|rt|src|proto|node_modules|public|@[a-z-]+|__)/.test(path) ||
        /\.(js|mjs|ts|css|map|png|svg|ico|json|html|woff2?)$/.test(path);
      const wantsHtml = (req.headers.accept ?? "").includes("text/html");
      if (!internal && wantsHtml && req.method === "GET" && (full.startsWith(BASE) || full === "/town")) {
        const query = url.includes("?") ? url.slice(url.indexOf("?")) : "";
        req.url = `${BASE}index.html${query}`;
      }
      next();
    });
  },
});

// Dev server: the browser sees one origin; /api goes to the API process and /rt to the realtime gateway. The API
// paths stay at the origin root (not under the base), so they also work when 5173 proxies /town here.
export default defineConfig({
  base: BASE,
  plugins: [appRoutes()],
  build: {
    rollupOptions: {
      output: {
        // three.js in its own named chunk, so the loading report can show its size apart (C14). It is reached only
        // through the dynamic import of src/gpu.ts, after the first paint.
        manualChunks: (id) => (id.includes("node_modules/three/") ? "three" : undefined),
      },
    },
  },
  server: {
    port: 5180,
    strictPort: true,
    proxy: {
      "/api": {
        target: process.env["PLINTH_API_URL"] ?? "http://127.0.0.1:8782",
        rewrite: (p) => p.replace(/^\/api/, ""),
      },
      "/rt": { target: process.env["PLINTH_RT_URL"] ?? "ws://127.0.0.1:8781", ws: true },
    },
  },
});
