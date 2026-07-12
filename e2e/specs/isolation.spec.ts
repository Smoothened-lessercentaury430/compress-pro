/**
 * CO-01…02: cross-origin isolation is live (COOP/COEP), which auto-activates
 * the bundled multithreaded WASM builds for AVIF and oxipng.
 */
import { expect, test } from '../fixtures';
import { gotoTab } from '../helpers';

test('CO-01: the app runs cross-origin isolated @smoke', async ({ page }) => {
	await gotoTab(page, 'jpg');
	expect(await page.evaluate(() => crossOriginIsolated), 'crossOriginIsolated').toBe(true);
	// SharedArrayBuffer only exists under COOP/COEP — the actual MT gate.
	expect(await page.evaluate(() => typeof SharedArrayBuffer)).toBe('function');
});

test('CO-02: record the thread budget the MT codecs will see', async ({ page, rec }) => {
	await gotoTab(page, 'jpg');
	const info = await page.evaluate(() => ({
		isolated: crossOriginIsolated,
		cores: navigator.hardwareConcurrency ?? 1
	}));
	expect(info.cores).toBeGreaterThanOrEqual(1);
	rec.record({
		id: 'CO-02',
		settings: { check: 'environment' },
		metrics: { crossOriginIsolated: info.isolated, hardwareConcurrency: info.cores },
		note: 'Context for benchmark timings: MT AVIF/oxipng scale with this core count.'
	});
});
