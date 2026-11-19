import { defineConfig } from "vite";

export default defineConfig({
  server: { host: "0.0.0.0", fs: { allow: [".."] } },
  build: { outDir: "dist" },
});
