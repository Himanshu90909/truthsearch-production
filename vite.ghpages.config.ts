// Overlay config for GitHub Pages hosting under /truthsearch-production/:
// relative asset base, normal chunked output (Pages serves correct MIME types).
import { mergeConfig, defineConfig, type UserConfig } from "vite";
import baseConfig from "./vite.config";

export default defineConfig(mergeConfig(baseConfig as UserConfig, {
  base: "./",
}));
