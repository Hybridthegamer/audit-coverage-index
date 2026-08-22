import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  // Mirror tsconfig's `@/*` path alias so tests can import modules that use it
  // as value imports (e.g. lib/ingest.ts -> @/db/schema), not just type-only.
  resolve: {
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
    },
  },
  test: {
    include: ["lib/**/*.test.ts"],
    environment: "node",
  },
});
