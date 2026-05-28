import { defineConfig } from "tsup";

export default defineConfig({
  clean: true,
  dts: true,
  entry: ["src/index.ts", "src/cli.ts", "src/worker.ts"],
  format: ["esm"],
  minify: false,
  shims: false,
  sourcemap: true,
  splitting: false,
  target: "es2022"
});
