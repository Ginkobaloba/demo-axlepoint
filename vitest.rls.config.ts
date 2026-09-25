import { defineConfig } from "vitest/config";
import path from "node:path";

/**
 * Integration suite (`npm run test:rls`). Separate from vitest.config.ts so the
 * default `npm test` stays database-free, and so the tests that need a real
 * Postgres cannot be quietly absorbed into a run that has none and reported as
 * passing.
 *
 * Single-threaded and non-concurrent on purpose: these tests DROP AND RECREATE
 * the public schema in beforeAll and then assert on catalog state. Two workers
 * against one database would race, and the failure would look like a flaky leak
 * rather than a broken harness.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.itest.ts"],
    globals: false,
    fileParallelism: false,
    sequence: { concurrent: false },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
