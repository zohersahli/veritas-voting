import path from "path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
    dedupe: ["react", "react-dom"],
  },
  build: {
    sourcemap: true,
    chunkSizeWarningLimit: 800,
  },
  optimizeDeps: {
    include: ["@walletconnect/ethereum-provider"],
  },
});
