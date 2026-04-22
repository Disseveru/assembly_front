import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["tests/**/*.{test,spec}.{ts,js}"],
    alias: {
      "~/": resolve(__dirname, "./") + "/"
    }
  },
  resolve: {
    alias: {
      "~/": resolve(__dirname, "./") + "/"
    }
  }
});