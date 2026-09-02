import { test, expect } from "@playwright/test"

/**
 * Placeholder: proves the e2e pipeline step is real (server built, started,
 * and reachable), not a check that always passes. Deliberately does not
 * assert on page copy — src/app/page.tsx is expected to be rewritten as the
 * product takes shape.
 */
test("home page responds", async ({ page }) => {
  const response = await page.goto("/")

  expect(response).not.toBeNull()
  expect(response?.status()).toBe(200)
})
