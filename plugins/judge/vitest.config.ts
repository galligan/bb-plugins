import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Frontend harness tests only. `lib/` stays on `node --test`.
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL(".", import.meta.url)).slice(0, -1) },
  },
  test: {
    include: ["components/**/*.test.tsx"],
    environment: "jsdom",
    setupFiles: ["./components/test-setup.ts"],
  },
});
