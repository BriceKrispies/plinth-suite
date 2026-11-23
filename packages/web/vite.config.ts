import { defineConfig, type Plugin } from "vite";
import basicSsl from "@vitejs/plugin-basic-ssl";

// Single-page app: every route (`/store/c/apparel`, `/d/programme.overview`, `/people/maya-ortiz`) serves the
// one page and the client router resolves it. Paths with dots in them would otherwise be treated as files, so
// rewrite any HTML navigation that is not an API, realtime, source or Vite internal path.
const appRoutes = (): Plugin => ({
  name: "plinth-app-routes",
  configureServer(server) {
    server.middlewares.use((req, _res, next) => {
      const url = req.url ?? "";
      const path = url.split("?")[0] ?? "";
      const internal =
        /^\/town(\/|$)/.test(path) ||
        /^\/(api|rt|src|proto|node_modules|public|@[a-z-]+|__)/.test(path) ||
        /\.(js|mjs|css|map|png|svg|ico|json|html|woff2?)$/.test(path);
      const wantsHtml = (req.headers.accept ?? "").includes("text/html");
      if (!internal && wantsHtml && req.method === "GET") {
        const query = url.includes("?") ? url.slice(url.indexOf("?")) : "";
        req.url = `/index.html${query}`;
      }
      next();
    });
  },
});

// Dev server: the browser sees one origin; /api goes to the API process and /rt to the realtime gateway.
export default defineConfig(({ mode }) => ({
  // `--mode https` (pnpm dev:https, port 5443) serves HTTPS with a self-signed certificate, so phones on the LAN get a
  // secure context (WebGPU needs one). Accept the certificate warning once on the phone.
  plugins: [appRoutes(), ...(mode === "https" ? [basicSsl({ name: "plinth-lan" })] : [])],
  server: {
    proxy: {
      "/api": {
        target: process.env["PLINTH_API_URL"] ?? "http://127.0.0.1:8782",
        rewrite: (p) => p.replace(/^\/api/, ""),
      },
      // The Township GPU site (packages/town-spike, base "/town/") is served under this origin, HMR socket included.
      "/town": { target: process.env["PLINTH_TOWN_URL"] ?? "http://127.0.0.1:5180", ws: true },
      "/rt": { target: process.env["PLINTH_RT_URL"] ?? "ws://127.0.0.1:8781", ws: true },
    },
  },
}));
