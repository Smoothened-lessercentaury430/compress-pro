/**
 * HE-01…03: HEIC tab specifics — no GIF pill, resize through icodec decode,
 * no Compare button (browsers can't render HEIC previews).
 */
import { readFileSync } from 'node:fs';
import { FIXTURES, assertDiffBudget, expect, fx, test } from '../fixtures';
import { compress, downloadRow, gotoTab, rows, setMaxDimension, upload } from '../helpers';
import { imageMeta, pixelDiff } from '../verify';
import { DIFF_BUDGET } from '../thresholds';

test.skip(() => !FIXTURES.heicAvailable, 'sips HEIC fixture unavailable');

test('HE-01: output pills exclude GIF, default JPG', async ({ page }) => {
	await gotoTab(page, 'heic');
	await upload(page, fx('iphone-photo.heic')); // controls render once files exist
	await expect(page.getByRole('button', { name: 'GIF', exact: true })).toHaveCount(0);
	for (const pill of ['Auto', 'JPG', 'PNG', 'WebP', 'AVIF']) {
		await expect(page.getByRole('button', { name: pill, exact: true })).toBeVisible();
	}
	await expect(page.getByRole('button', { name: 'JPG', exact: true })).toHaveAttribute(
		'aria-pressed',
		'true'
	);
});

test('HE-02: heic → jpg with maxDimension 600 → 600×400', async ({ page, rec }) => {
	await gotoTab(page, 'heic');
	await upload(page, fx('iphone-photo.heic'));
	await setMaxDimension(page, 600);
	await compress(page);
	const art = await downloadRow(page);
	const m = await imageMeta(art.bytes);
	expect(art.name).toBe('iphone-photo.jpg');
	expect(m.format).toBe('jpeg');
	expect([m.width, m.height]).toEqual([600, 400]);
	// Real HEIC decode (icodec) vs the resized jpg — the HEVC baseline loss
	// and the resize comparison error STACK, so the budgets add up
	// (observed 0.0376 vs the 0.085 sum → ~2.3× headroom).
	const { ratio } = await pixelDiff(readFileSync(fx('iphone-photo.heic')), art.bytes);
	assertDiffBudget(ratio, DIFF_BUDGET.heicSource + DIFF_BUDGET.resized, 'HE-02 heic→jpg@600');
	rec.record({
		id: 'HE-02',
		settings: { tab: 'heic', output: 'jpg', maxDimension: 600, quality: 80 },
		input: { name: 'iphone-photo.heic', bytes: readFileSync(fx('iphone-photo.heic')).length },
		output: { name: art.name, bytes: art.bytes.length, width: m.width, height: m.height },
		metrics: { diffRatio: Number(ratio.toFixed(5)) },
		assets: {
			original: rec.saveAsset(
				'HE-02',
				'original',
				'iphone-photo.heic.preview.png',
				fx('iphone-photo.heic.preview.png')
			),
			output: rec.saveAsset('HE-02', 'output', art.name, art.bytes)
		}
	});
});

test('HE-03: HEIC result rows offer no Compare (undisplayable original)', async ({ page }) => {
	await gotoTab(page, 'heic');
	await upload(page, fx('iphone-photo.heic'));
	await compress(page);
	await expect(rows(page).getByRole('button', { name: 'Download' })).toBeVisible();
	await expect(rows(page).getByRole('button', { name: 'Compare' })).toHaveCount(0);
});

test('HE-04: an msf1 (sequence) HEIC warns that only the first frame converts', async ({
	page,
	rec
}) => {
	// iphone-burst.heic = the same still with its ftyp major brand patched to
	// msf1 — libheif returns only the primary image, and the app must say so
	// (GIF/APNG got this warning; HEIC sequences silently lost frames).
	await gotoTab(page, 'heic');
	await upload(page, fx('iphone-burst.heic'));
	await compress(page);
	await expect(page.getByTestId('row-warning')).toContainText(/first frame/);
	const art = await downloadRow(page);
	const m = await imageMeta(art.bytes);
	expect(m.format).toBe('jpeg');
	expect([m.width, m.height]).toEqual([1200, 800]);
	rec.record({
		id: 'HE-04',
		settings: { tab: 'heic', output: 'jpg', sequenceBrand: 'msf1' },
		input: { name: 'iphone-burst.heic', bytes: readFileSync(fx('iphone-burst.heic')).length },
		output: { name: art.name, bytes: art.bytes.length },
		note: 'Live-Photo/burst HEIC (msf1/avis brands) now warns instead of silently dropping frames.'
	});
});
