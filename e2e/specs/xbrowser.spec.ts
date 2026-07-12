/**
 * XB-01…04 (@xbrowser): capability-degradation smoke for Firefox/WebKit —
 * the app must WORK where the engine allows (wasm image codecs, EXIF byte
 * surgery are engine-agnostic) and DEGRADE GRACEFULLY where it doesn't
 * (WebCodecs video encode). Runs on chromium in every full run; the
 * firefox/webkit projects join under E2E_XBROWSER=1 (see playwright.config).
 */
import { expect, fx, fxVideo, test } from '../fixtures';
import { compress, downloadRow, gotoTab, rows, setOutputFormat, upload } from '../helpers';

function collectPageErrors(page: import('@playwright/test').Page): string[] {
	const errors: string[] = [];
	page.on('pageerror', (error) => errors.push(String(error)));
	return errors;
}

test('XB-01: home renders without uncaught exceptions @xbrowser', async ({ page }) => {
	const errors = collectPageErrors(page);
	await gotoTab(page, 'jpg');
	// The CTA appears only once files are queued — the load smoke asserts the
	// shell: heading + a working file input.
	await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
	await expect(page.locator('input[type=file]')).toBeAttached();
	expect(errors, 'no uncaught exceptions on load').toEqual([]);
});

test('XB-02: jpg → jpg compression works end-to-end @xbrowser', async ({ page }) => {
	const errors = collectPageErrors(page);
	await gotoTab(page, 'jpg');
	await upload(page, fx('photo-1200x800.jpg'));
	await setOutputFormat(page, 'JPG');
	await compress(page, { timeout: 120_000 });
	const art = await downloadRow(page);
	expect(art.bytes.length).toBeGreaterThan(1000);
	expect(art.bytes[0], 'JPEG magic').toBe(0xff);
	expect(art.bytes[1]).toBe(0xd8);
	expect(errors).toEqual([]);
});

test('XB-03: video tab succeeds or degrades to an explanation — never crashes @xbrowser', async ({
	page
}) => {
	test.setTimeout(180_000);
	const errors = collectPageErrors(page);
	await gotoTab(page, 'video');
	await upload(page, fxVideo('v-320x240-3s.mp4'));
	const cta = page.getByTestId('compress-cta');
	await expect(cta).toBeEnabled();
	await cta.click();
	// Either outcome is a pass; a hang or uncaught exception is the failure.
	const banner = page.getByTestId('error-banner');
	const download = rows(page).getByRole('button', { name: 'Download' }).first();
	const outcome = await Promise.race([
		banner.waitFor({ state: 'visible', timeout: 150_000 }).then(() => 'banner' as const),
		download.waitFor({ state: 'visible', timeout: 150_000 }).then(() => 'download' as const)
	]);
	if (outcome === 'banner') {
		await expect(banner, 'a helpful message, not a stack trace').toHaveText(/browser|convert/i);
	}
	expect(errors).toEqual([]);
});

test('XB-04: EXIF strip (pure byte surgery) works everywhere @xbrowser', async ({ page }) => {
	const errors = collectPageErrors(page);
	await gotoTab(page, 'exif');
	await upload(page, fx('exif-gps.jpg'));
	await compress(page, { timeout: 120_000 });
	await expect(page.getByTestId('row-info')).toHaveText(/Removed:/);
	const art = await downloadRow(page);
	expect(art.bytes.length).toBeGreaterThan(1000);
	expect(errors).toEqual([]);
});
