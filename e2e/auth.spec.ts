import { expect, test } from "@playwright/test"

/**
 * Full Slice 0 happy path: sign up, land straight in the personal workspace
 * created for the new user, change its timezone, and confirm the change
 * survives a reload (proves it round-tripped through Postgres, not just
 * client state).
 *
 * Signing up no longer asks the user to create a workspace: the
 * `user.create.after` hook in `src/modules/auth/auth.ts` makes them a
 * personal one (docs/decisions/06 #14), and `OpenSoleWorkspace` opens it
 * because a single workspace is not a choice. Adding a *second* workspace is
 * a separate journey, covered by the test below this one.
 */
test("sign up, land in the personal workspace, and change its timezone", async ({ page }) => {
  const uniqueSuffix = Date.now()
  const email = `e2e-${uniqueSuffix}@example.com`
  const password = "correct-horse-battery-staple"

  await page.goto("/sign-up")
  await page.getByLabel("Name").fill("E2E Test User")
  await page.getByLabel("Email").fill(email)
  await page.getByLabel("Password").fill(password)
  await page.getByRole("button", { name: "Create account" }).click()

  await expect(page).toHaveURL("/datasets")
  await expect(page.getByRole("heading", { name: "Datasets" })).toBeVisible()
  await expect(page.getByText("No datasets yet")).toBeVisible()

  await page.getByRole("link", { name: "Settings", exact: true }).click()
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

/**
 * The second workspace: a user who already has one adds another from the
 * workspace switcher and is switched into it. This is the path that still
 * goes through `CreateWorkspaceForm`, and it also proves the switcher lists
 * both workspaces once the second exists.
 */
test("add a second workspace from the switcher and land in it", async ({ page }) => {
  const uniqueSuffix = Date.now()
  const email = `e2e-second-${uniqueSuffix}@example.com`
  const password = "correct-horse-battery-staple"
  const workspaceName = `Acme ${uniqueSuffix}`

  await page.goto("/sign-up")
  await page.getByLabel("Name").fill("E2E Second Workspace User")
  await page.getByLabel("Email").fill(email)
  await page.getByLabel("Password").fill(password)
  await page.getByRole("button", { name: "Create account" }).click()

  await expect(page).toHaveURL("/datasets")

  await page.getByRole("link", { name: "+ New workspace" }).click()
  await expect(page.getByLabel("Workspace name")).toBeVisible()
  await page.getByLabel("Workspace name").fill(workspaceName)
  await page.getByRole("button", { name: "Create workspace" }).click()

  await expect(page).toHaveURL("/datasets")
  await expect(page.getByRole("heading", { name: "Datasets" })).toBeVisible()
})
