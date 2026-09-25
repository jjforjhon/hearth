import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": { target: "http://localhost:4318", changeOrigin: true },
      "/socket.io": { target: "http://localhost:4318", ws: true },
      "/media": { target: "http://localhost:4318", changeOrigin: true },
    },
  },
  build: {
    sourcemap: false,
    target: "es2022",
  },
});
