import { defineConfig } from "vitest/config";
import path from "node:path";

/**
 * Vitest config (chunk 4b). The Next.js app uses tsconfig path aliases for
 * `@/*`; Vitest needs the same alias mirrored here so `import "@/lib/foo"`
 * resolves inside test files.
 *
 * We target the node environment because the modules under test are server
 * only (verifyPortalToken, handoff route). No jsdom needed.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    globals: false,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
