import { defineConfig } from "vite";

export default defineConfig({
  // Compiled modules import the standard library from the repository root.
  server: { fs: { allow: ["../.."] } },
  build: { outDir: "dist" },
});
