/**
 * ST-01…02: per-tab settings persist across reloads (localStorage store).
 */
import { expect, fx, test } from '../fixtures';
import { gotoTab, setOutputFormat, setQuality, setTargetKb, upload } from '../helpers';

test('ST-01: quality survives a reload', async ({ page }) => {
	await gotoTab(page, 'jpg');
	await upload(page, fx('tiny-optimized.jpg')); // controls render once files exist
	await setQuality(page, 55);

	await page.reload();
	await gotoTab(page, 'jpg');
	await upload(page, fx('tiny-optimized.jpg'));
	await expect(page.locator('#quality')).toHaveValue('55');
	await expect(page.getByText('55%')).toBeVisible();
});

test('ST-02: output format and target mode survive a reload', async ({ page }) => {
	await gotoTab(page, 'png');
	await upload(page, fx('graphic-alpha.png'));
	await setOutputFormat(page, 'WebP');
	await setTargetKb(page, 250);

	await page.reload();
	await gotoTab(page, 'png');
	await upload(page, fx('graphic-alpha.png'));
	await expect(page.getByRole('button', { name: 'WebP', exact: true })).toHaveAttribute(
		'aria-pressed',
		'true'
	);
	await expect(page.locator('button[data-seg="target"]')).toHaveAttribute('aria-pressed', 'true');
	await expect(page.locator('#target-size-kb')).toHaveValue('250');
});
