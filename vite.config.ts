import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite";
import path from "node:path";

const api = process.env.API_ORIGIN ?? "http://localhost:5000";

export default defineConfig({
  root: path.resolve(__dirname, "client"),
  publicDir: path.resolve(__dirname, "public"),
  plugins: [react(), tailwind()],
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
