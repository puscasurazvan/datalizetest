import { expect, test } from "@playwright/test"

/**
 * Full Slice 0 happy path: sign up, create a workspace, land on the
 * datasets page, change the workspace timezone, and confirm the change
 * survives a reload (proves it round-tripped through Postgres, not just
 * client state).
 */
test("sign up, create a workspace, and change its timezone", async ({ page }) => {
  const uniqueSuffix = Date.now()
  const email = `e2e-${uniqueSuffix}@example.com`
  const password = "correct-horse-battery-staple"
  const workspaceName = `Acme ${uniqueSuffix}`

  await page.goto("/sign-up")
  await page.getByLabel("Name").fill("E2E Test User")
  await page.getByLabel("Email").fill(email)
  await page.getByLabel("Password").fill(password)
  await page.getByRole("button", { name: "Create account" }).click()

  await expect(page.getByRole("heading", { name: "Create your workspace" })).toBeVisible()
  await page.getByLabel("Workspace name").fill(workspaceName)
  await page.getByRole("button", { name: "Create workspace" }).click()

  await expect(page).toHaveURL("/datasets")
  await expect(page.getByRole("heading", { name: "Datasets" })).toBeVisible()
  await expect(page.getByText("No datasets yet")).toBeVisible()

  await page.getByRole("link", { name: "Workspace settings" }).click()
  await expect(page).toHaveURL("/settings")
  await expect(
    page.getByText(
      "Changing this will affect how all date-based charts group data. Historical query results are not retroactively updated.",
    ),
  ).toBeVisible()

  await page.getByLabel("Timezone").selectOption("America/New_York")
  await page.getByRole("button", { name: "Save timezone" }).click()
  await expect(page.getByText("Timezone updated to America/New_York.")).toBeVisible()

  await page.reload()
  await expect(page.getByLabel("Timezone")).toHaveValue("America/New_York")
})
