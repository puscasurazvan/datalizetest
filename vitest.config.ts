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
          // A "unit" test can still import a module that reaches `env()` at
          // load time merely by importing something DB-adjacent (e.g.
          // `@/modules/organizations`, for `toPolicyContext`) even when the
          // function under test is pure and never queries anything — env.ts
          // validates eagerly, at first import, for every caller alike. Load
          // the same throwaway values integration uses so that import never
          // throws; nothing in this project actually opens a connection.
          setupFiles: ["./tests/setup-env.ts"],
        },
      },
      {
        // Integration tests talk to the throwaway Postgres on 5434.
        extends: true,
        test: {
          name: "integration",
          environment: "node",
          include: ["src/**/*.integration.test.ts"],
          setupFiles: ["./tests/setup-env.ts"],
          fileParallelism: false,
        },
      },
    ],
  },
})
