import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";

// Tauri 期望固定开发端口；前端产物输出到 dist/，由 tauri.conf.json 的 frontendDist 引用。
export default defineConfig({
  plugins: [svelte()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    // cargo 编译期间会锁定 target/ 下的 dll；Vite 的 watcher 若尝试 watch 这些文件
    // 会抛 EBUSY 并导致 dev server 崩溃，因此整体忽略 src-tauri/。
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
  build: {
    target: "chrome105",
    sourcemap: false,
  },
});
