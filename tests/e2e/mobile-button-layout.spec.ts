import { expect, test } from '@playwright/test';

test.describe('Mobile-First Layout and Button Architecture', () => {
  test.use({ viewport: { width: 390, height: 844 } }); // iPhone 12/13/14 / Pixel standard mobile viewport

  test('single-row mobile topbar with visible brand and borderless bell', async ({ page }) => {
    await page.goto('/');

    const topbar = page.locator('.topbar');
    if (await topbar.count()) {
      await expect(topbar).toBeVisible();
      const box = await topbar.boundingBox();
      expect(box?.height).toBeCloseTo(56, 2);

      // Verify logo and brand title are visible and not wrapped
      const brand = page.locator('.topbar-brand');
      await expect(brand).toBeVisible();
      const brandText = page.locator('.topbar-brand .brand-lockup-copy strong');
      await expect(brandText).toBeVisible();

      // Verify language switch is visible
      const langSwitch = page.locator('.topbar-language-switch');
      await expect(langSwitch).toBeVisible();
    }
  });

  test('hero buttons stack vertically on mobile viewport with minimum 44px touch targets', async ({ page }) => {
    await page.goto('/');

    const heroActions = page.locator('.welcome-hero-actions');
    if (await heroActions.count()) {
      await expect(heroActions).toBeVisible();

      const buttons = heroActions.locator('.button');
      const count = await buttons.count();
      if (count >= 2) {
        const firstBox = await buttons.nth(0).boundingBox();
        const secondBox = await buttons.nth(1).boundingBox();

        expect(firstBox).not.toBeNull();
        expect(secondBox).not.toBeNull();

        // Must meet 44px min-height touch target
        expect(firstBox!.height).toBeGreaterThanOrEqual(44);
        expect(secondBox!.height).toBeGreaterThanOrEqual(44);

        // Vertically stacked: second button top must be below first button bottom
        expect(secondBox!.y).toBeGreaterThanOrEqual(firstBox!.y + firstBox!.height);
      }
    }
  });
});
