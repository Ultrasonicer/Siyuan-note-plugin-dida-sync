import { defineConfig } from "vite";
import { copyFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

export default defineConfig({
  plugins: [{
    name: "copy-plugin-files",
    closeBundle() {
      mkdirSync("dist", { recursive: true });
      for (const file of ["plugin.json", "README.md", "README_zh_CN.md", "VALIDATION.md", "LICENSE", "icon.png", "preview.png"]) {
        copyFileSync(file, resolve("dist", file));
      }
    },
  }],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    lib: { entry: resolve("src/index.ts"), formats: ["cjs"], fileName: () => "index.js" },
    rollupOptions: {
      external: ["siyuan"],
      output: { assetFileNames: "index.[ext]" },
    },
  },
});
