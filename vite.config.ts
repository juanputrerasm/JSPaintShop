import { defineConfig } from "vite";

export default defineConfig({
  // Relative paths, so the built app runs from any folder of a static server (such as /jstraxx/).
  base: "./",
  worker: { format: "es" },
  build: { target: "es2022" },
});
