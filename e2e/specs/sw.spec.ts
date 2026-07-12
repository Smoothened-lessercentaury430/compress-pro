/**
 * SW-01…02: the service worker registers, controls the page, and preserves
 * cross-origin isolation when serving from its cache. Preview-only: the dev
 * server has no built service worker ($service-worker `build` is empty there).
 */
import { expect, test } from '../fixtures';
import { gotoTab } from '../helpers';

test.skip(() => !process.env.E2E_PREVIEW, 'service worker exists only in the built app');

test('SW-01: registers, takes control, and keeps crossOriginIsolated true', async ({ page }) => {
	await gotoTab(page, 'jpg');
	await page.evaluate(() => navigator.serviceWorker.ready);
	await page.reload();
	await gotoTab(page, 'jpg');
	const state = await page.evaluate(() => ({
		controlled: navigator.serviceWorker.controller !== null,
		isolated: crossOriginIsolated
	}));
	expect(state.controlled, 'page is controlled by the SW').toBe(true);
	expect(state.isolated, 'cached responses keep COOP/COEP').toBe(true);
});

test('SW-02: versioned cache exists and holds the shell', async ({ page }) => {
	await gotoTab(page, 'jpg');
	await page.evaluate(() => navigator.serviceWorker.ready);
	const keys = await page.evaluate(() => caches.keys());
	expect(
		keys.some((k) => k.startsWith('app-')),
		`cache keys: ${keys.join(', ')}`
	).toBe(true);
});
