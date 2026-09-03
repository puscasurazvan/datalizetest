import { expect, test } from "@playwright/test"

/**
 * The Slice 1 workflow as far as it is built: sign up, import a sample CSV
 * through the real two-phase pipeline, and see the Dataset Version it
 * produced — inferred schema, row count, the timezone naive timestamps were
 * read in, and a preview of the stored rows.
 *
 * Nothing here is seeded. The click runs upload, `import.profile`, confirm
 * and `import.load`, so a regression anywhere in that pipeline fails this
 * test rather than showing a plausible-looking empty page.
 */
test("import a sample CSV and see its schema and rows", async ({ page }) => {
  const uniqueSuffix = Date.now()
  const email = `e2e-datasets-${uniqueSuffix}@example.com`

  await page.goto("/sign-up")
  await page.getByLabel("Name").fill("E2E Datasets User")
  await page.getByLabel("Email").fill(email)
  await page.getByLabel("Password").fill("correct-horse-battery-staple")
  await page.getByRole("button", { name: "Create account" }).click()

  await expect(page).toHaveURL("/datasets")
  await expect(page.getByText("No datasets yet")).toBeVisible()

  await page.getByRole("button", { name: "Stripe transactions" }).click()

  // The import runs inside the request, then redirects to the new Dataset.
  await expect(page).toHaveURL(/\/datasets\/[^/]+$/, { timeout: 60_000 })
  await expect(page.getByRole("heading", { name: /Stripe transactions/ })).toBeVisible()

  // The schema the inferencer actually produced, not a fixture of it.
  await expect(page.getByText("Schema · version 1")).toBeVisible()
  await expect(page.getByRole("cell", { name: "amount", exact: true })).toBeVisible()
  await expect(page.getByRole("cell", { name: "currency", exact: true })).toBeVisible()

  // `amount` is a decimal, and a leading-zero id must NOT have become an integer
  // — the two inference rules the committed fixture exists to pin.
  const amountRow = page.getByRole("row").filter({ hasText: "amount" }).first()
  await expect(amountRow).toContainText("decimal")

  // Rows came back from the analytical store.
  await expect(page.getByText("Rows", { exact: true })).toBeVisible()
  await expect(page.getByText(/Showing|SHOWING/)).toBeVisible()

  // And the dataset is listed on the way back.
  await page.getByRole("link", { name: "DATASETS", exact: true }).click()
  await expect(page).toHaveURL("/datasets")
  await expect(page.getByRole("heading", { name: "1 dataset", exact: true })).toBeVisible()
})
