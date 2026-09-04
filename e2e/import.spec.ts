import path from "node:path"

import { expect, test } from "@playwright/test"

/**
 * The real upload path (as opposed to datasets.spec.ts's one-click sample):
 * pick a file from disk, land on `/imports/[id]` in the `awaiting_confirmation`
 * phase, override one column's type, confirm, and follow the completed
 * import to the Dataset it produced. This is the only spec that drives
 * `ImportCsvButton`'s browser-side PUT and the confirm screen's override
 * `<select>`s — `datasets.spec.ts` never opens that dialog.
 */
test("upload a CSV, override a column type on the confirm screen, and land on its Dataset", async ({
  page,
}) => {
  const uniqueSuffix = Date.now()
  const email = `e2e-import-${uniqueSuffix}@example.com`

  await page.goto("/sign-up")
  await page.getByLabel("Name").fill("E2E Import User")
  await page.getByLabel("Email").fill(email)
  await page.getByLabel("Password").fill("correct-horse-battery-staple")
  await page.getByRole("button", { name: "Create account" }).click()
  await expect(page).toHaveURL("/datasets")

  await page.getByRole("button", { name: "Import CSV", exact: true }).click()
  const dialog = page.getByRole("dialog")
  await dialog
    .getByLabel("CSV file")
    .setInputFiles(path.join(process.cwd(), "tests", "fixtures", "transactions_stripe.csv"))
  // Prefilled from the filename (import-csv-button.tsx's `deriveDatasetName`);
  // give it a name unique enough to find on the way back.
  const datasetName = `E2E import ${uniqueSuffix}`
  await dialog.getByLabel("Dataset name").fill(datasetName)
  await dialog.getByRole("button", { name: "Import", exact: true }).click()

  // Profile runs inside the request, then this navigates to the import.
  await expect(page).toHaveURL(/\/imports\/[^/]+$/, { timeout: 30_000 })

  // The confirm screen: the fixture's real inferred schema, not a fixture of
  // it — `amount` infers `decimal` (tests/fixtures/README.md).
  const amountOverride = page.getByLabel("Type override for amount")
  await expect(amountOverride).toHaveValue("decimal")
  // `→ string` is the one override proposed-schema-table.tsx exempts from
  // this consequence line (every value parses as a string) — `integer`
  // exercises the actual H2 case: a narrowing override the sampled decimal
  // values won't cleanly parse as.
  await amountOverride.selectOption("integer")
  await expect(page.getByText(/load as NULL and are recorded as issues/)).toBeVisible()

  await page.getByRole("button", { name: "Confirm and load" }).click()

  // `import.load` runs as a real background job (InlineDispatcher in this
  // environment); ImportProgress polls every 2s until it lands on the
  // completed outcome — no manual navigation. "Go to this Dataset" only
  // renders on that outcome (import-outcome.tsx), so waiting for it is
  // waiting for completion.
  const goToDataset = page.getByRole("link", { name: "Go to this Dataset" })
  await expect(goToDataset).toBeVisible({ timeout: 30_000 })
  await goToDataset.click()

  await expect(page).toHaveURL(/\/datasets\/[^/]+$/)
  await expect(page.getByRole("heading", { name: datasetName })).toBeVisible()
  await expect(page.getByRole("heading", { name: /Schema · \d+ columns · v1/ })).toBeVisible()

  // The override actually reached the committed schema: `amount` is
  // `integer`, not the inferred `decimal`.
  const amountRow = page.getByRole("row").filter({ hasText: "amount" }).first()
  await expect(amountRow).toContainText("integer")
})
