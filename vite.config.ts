import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

// The dashboard lives in web/ and is built into dist/web, which the router serves.
export default defineConfig({
  root: "web",
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@server": fileURLToPath(new URL("./src", import.meta.url)),
      "@": fileURLToPath(new URL("./web/src", import.meta.url)),
    },
  },
  build: { outDir: "../dist/web", emptyOutDir: true },
  server: { proxy: { "/api": "http://127.0.0.1:3456" } },
  // Vitest reads this file too; its tests live in test/ at the repo root.
  // Agent worktrees under .claude/worktrees hold copies of the tests; leave them out.
  test: { root: ".", exclude: ["**/node_modules/**", ".claude/**"] },
});
