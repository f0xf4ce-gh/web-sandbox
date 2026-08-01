import { defineConfig } from "vite";

export default defineConfig({
  root: "client",
  publicDir: "../assets",
  build: {
    outDir: "../dist",
    emptyOutDir: true,
    target: "es2022"
  }
});
