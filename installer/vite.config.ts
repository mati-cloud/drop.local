import { defineConfig } from "vite-plus";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": `${import.meta.dirname}/src/mainview`,
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
