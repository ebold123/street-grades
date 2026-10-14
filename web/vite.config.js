import { defineConfig } from "vite";

// base "./" lets the built site be served from any sub-path (GitHub Pages, S3, etc.).
export default defineConfig({
  base: "./",
});
