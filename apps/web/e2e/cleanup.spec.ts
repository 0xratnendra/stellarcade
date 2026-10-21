import { test, expect } from "@playwright/test";

test.describe("Cleanup (/cleanup)", () => {
  test("loads hygiene scanner and runs dry-run analysis", async ({ page }) => {
    await page.goto("/cleanup");

    await expect(page.locator("h1").first()).toContainText("Cleanup & Reserve Recovery");

   
    const scanBtn = page.getByRole("button", { name: /Scan Account/i });
    await expect(scanBtn).toBeVisible();
    await scanBtn.click();

    
    await expect(page.getByText(/Base.*Account Reserve/i).first()).toBeVisible();
  });
});
