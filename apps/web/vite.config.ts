import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: "/ai/",        // 部署在 Apache 反代 /ai/ 下：所有 asset URL 走 /ai/assets/...
  build: {
    outDir: "dist",
    assetsDir: "assets"
  },
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:3001",
      "/health": "http://localhost:3001"
    }
  }
});
