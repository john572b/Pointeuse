import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

export default defineConfig({
  root: "web",
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": path.resolve(__dirname, "web/src"), "@shared": path.resolve(__dirname, "shared") },
  },
  server: { port: 5173, proxy: { "/api": "http://localhost:8787" } },
  build: { outDir: "../dist/web", emptyOutDir: true, chunkSizeWarningLimit: 1200 },
});
