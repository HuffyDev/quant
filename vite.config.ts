import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite";
import path from "node:path";
import fs from "node:fs";

const api = process.env.API_ORIGIN ?? "http://localhost:5000";

export default defineConfig({
  root: path.resolve(__dirname, "client"),
  publicDir: path.resolve(__dirname, "public"),
  plugins: [react(), tailwind()],
  // only probe /models/brain.glb when one was shipped (avoids a 404 on every load); else the root.png cloud is used
  define: { __HAS_BRAIN_MODEL__: JSON.stringify(fs.existsSync(path.resolve(__dirname, "public/models/brain.glb"))) },
  resolve: { alias: { "@shared": path.resolve(__dirname, "shared") } },
  build: { outDir: path.resolve(__dirname, "dist"), emptyOutDir: true, chunkSizeWarningLimit: 1200 },
  server: {
    host: "0.0.0.0",
    port: 5173,
    proxy: {
      "/api": api,
      "/admin/api": api,
      "/sim": api,
      "/socket.io": { target: api, ws: true },
    },
  },
});
