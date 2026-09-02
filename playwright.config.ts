import { defineConfig, devices } from "@playwright/test"

/**
 * `process.env.CI` here (and not `env()` from src/shared/env) is a deliberate,
 * narrow exception: this file, like drizzle.config.ts at the repo root, is
 * tooling config that runs outside the app runtime and before `env()`'s
 * schema would even apply. `src/shared/env.ts` remains the only place
 * application code reads `process.env`.
 *
 * webServer command: the CI workflow already runs `pnpm build` as its own
 * named step before `test:e2e`, so on CI this only needs `pnpm start` against
 * that build. Locally, where no prior build is guaranteed, it builds first.
 * Either avoids serving stale dev-mode output under a production baseURL.
 */
const isCi = Boolean(process.env.CI)

export default defineConfig({
  testDir: "./e2e",

  fullyParallel: true,
  forbidOnly: isCi,
  retries: isCi ? 2 : 0,
  // `workers` is typed `string | number` with no `undefined` member, so under
  // exactOptionalPropertyTypes the key must be omitted locally, not set to
  // undefined, to fall back to Playwright's own default.
  ...(isCi ? { workers: 1 } : {}),

  // Explicit rather than relying on Playwright's implicit CI->never default:
  // a failure on CI must not block the job waiting on a report server.
  reporter: [["html", { open: isCi ? "never" : "on-failure" }]],

  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],

  webServer: {
    command: isCi ? "pnpm start" : "pnpm build && pnpm start",
    url: "http://localhost:3000",
    reuseExistingServer: !isCi,
    timeout: 240_000,
    stdout: "pipe",
    stderr: "pipe",
  },
})
