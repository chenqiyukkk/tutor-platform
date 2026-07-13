import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "jsdom",
    // Integration files share one real PostgreSQL instance; running files in
    // parallel creates lock contention and masks behavior with timeouts.
    fileParallelism: false,
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
  },
});
