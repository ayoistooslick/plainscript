import { defineConfig } from "vite";
export default defineConfig({
  server: {
    fs: { allow: ["../.."] },
    proxy: { "/api": "http://127.0.0.1:4410" },
  },
  build: { outDir: "dist" },
});
