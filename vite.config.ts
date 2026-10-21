import { defineConfig } from "vite";
export default defineConfig({
  root: "ui",
  build: { outDir: "../dist/ui", emptyOutDir: true },
  server: {
    port: 5173,
    proxy: { "/v1": "http://127.0.0.1:4173", "/demo": "http://127.0.0.1:4173" },
  },
});
