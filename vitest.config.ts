import { defineConfig } from "vitest/config"
import react from "@vitejs/plugin-react"
import { fileURLToPath } from "node:url"

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          environment: "node",
          include: ["src/**/*.test.ts", "src/**/*.test.tsx", "scripts/**/*.test.ts"],
          // "*.integration.test.ts" also matches "*.test.ts" — exclude it, or the
          // unit project runs tests that need a database and fails without one.
          exclude: ["src/**/*.integration.test.ts"],
        },
      },
      {
        // Integration tests talk to the throwaway Postgres on 5434.
        extends: true,
        test: {
          name: "integration",
          environment: "node",
          include: ["src/**/*.integration.test.ts"],
          setupFiles: ["./tests/setup-integration.ts"],
          fileParallelism: false,
        },
      },
    ],
  },
})
