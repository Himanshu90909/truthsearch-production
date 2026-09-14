// Overlay config for flat-CDN static hosting: single JS chunk (no dynamic
// imports), all assets (fonts, wasm) inlined as data URIs, relative base.
import { mergeConfig, defineConfig, type UserConfig } from "vite";
import baseConfig from "./vite.config";

export default defineConfig(mergeConfig(baseConfig as UserConfig, {
  base: "./",
  build: {
    assetsInlineLimit: 100_000_000,
    chunkSizeWarningLimit: 100_000,
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
      },
    },
  },
}));
