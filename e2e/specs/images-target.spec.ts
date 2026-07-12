/**
 * T-01…07: target-size mode — fit under target, unreachable-target warning,
 * target + conversion, keep-original inside target mode, GIF hides target UI,
 * opt-in downscale-to-target (rescue + 320 px floor).
 */
import { readFileSync } from 'node:fs';
import { expect, fx, fxMeta, test } from '../fixtures';
import {
	compress,
	downloadRow,
	gotoTab,
	setOutputFormat,
	setTargetKb,
	toggle,
	upload
} from '../helpers';
import { imageMeta } from '../verify';

test('T-01: target fits without warning @smoke', async ({ page, rec }) => {
	const inputBytes = fxMeta<{ size: number }>('photo-1200x800.jpg').size;
	// 60% of the source guarantees the search must actually drop quality.
	const targetKb = Math.round((inputBytes * 0.6) / 1000);
	await gotoTab(page, 'jpg');
	await upload(page, fx('photo-1200x800.jpg'));
	await setOutputFormat(page, 'JPG'); // pinned: the tab default became Auto
	await setTargetKb(page, targetKb);
	const run = await compress(page);
	expect(run.warnings, 'reachable target must not warn').toEqual([]);
	const art = await downloadRow(page);
	expect(art.bytes.length, `fits under ${targetKb} KB`).toBeLessThanOrEqual(targetKb * 1000);
	rec.record({
		id: 'T-01',
		settings: { tab: 'jpg', mode: 'target', targetKb },
		input: { name: 'photo-1200x800.jpg', bytes: inputBytes },
		output: { name: art.name, bytes: art.bytes.length },
		metrics: { targetBytes: targetKb * 1000, fits: art.bytes.length <= targetKb * 1000 },
		assets: {
			original: rec.saveAsset('T-01', 'original', 'photo-1200x800.jpg', fx('photo-1200x800.jpg')),
			output: rec.saveAsset('T-01', 'output', art.name, art.bytes)
		}
	});
});

test('T-02: unreachable 1 KB target warns and returns the smallest attempt', async ({
	page,
	rec
}) => {
	const inputBytes = readFileSync(fx('photo-1200x800.jpg')).length;
	await gotoTab(page, 'jpg');
	await upload(page, fx('photo-1200x800.jpg'));
	await setOutputFormat(page, 'JPG'); // pinned: the tab default became Auto
	await setTargetKb(page, 1);
	const run = await compress(page);
	expect(run.warnings.join('\n')).toMatch(/not reachable/i);
	const art = await downloadRow(page);
	expect(art.bytes.length, 'smallest attempt is still far below input').toBeLessThan(
		inputBytes / 2
	);
	rec.record({
		id: 'T-02',
		settings: { tab: 'jpg', mode: 'target', targetKb: 1 },
		input: { name: 'photo-1200x800.jpg', bytes: inputBytes },
		output: { name: art.name, bytes: art.bytes.length },
		warnings: run.warnings,
		metrics: { targetBytes: 1000, fits: false },
		assets: {
			original: rec.saveAsset('T-02', 'original', 'photo-1200x800.jpg', fx('photo-1200x800.jpg')),
			output: rec.saveAsset('T-02', 'output', art.name, art.bytes)
		}
	});
});

test('T-03: target combined with jpg→webp conversion', async ({ page, rec }) => {
	const inputBytes = fxMeta<{ size: number }>('photo-1200x800.jpg').size;
	const targetKb = Math.round((inputBytes * 0.5) / 1000);
	await gotoTab(page, 'jpg');
	await upload(page, fx('photo-1200x800.jpg'));
	await setOutputFormat(page, 'WebP');
	await setTargetKb(page, targetKb);
	const run = await compress(page);
	expect(run.warnings).toEqual([]);
	const art = await downloadRow(page);
	expect(art.name).toBe('photo-1200x800.webp');
	const m = await imageMeta(art.bytes);
	expect(m.format).toBe('webp');
	expect(art.bytes.length).toBeLessThanOrEqual(targetKb * 1000);
	rec.record({
		id: 'T-03',
		settings: { tab: 'jpg', output: 'webp', mode: 'target', targetKb },
		input: { name: 'photo-1200x800.jpg', bytes: inputBytes },
		output: { name: art.name, bytes: art.bytes.length, format: m.format },
		assets: {
			original: rec.saveAsset('T-03', 'original', 'photo-1200x800.jpg', fx('photo-1200x800.jpg')),
			output: rec.saveAsset('T-03', 'output', art.name, art.bytes)
		}
	});
});

test('T-04: already-fitting original is kept byte-identical in target mode', async ({
	page,
	rec
}) => {
	const input = readFileSync(fx('tiny-optimized.jpg'));
	await gotoTab(page, 'jpg');
	await upload(page, fx('tiny-optimized.jpg'));
	await setOutputFormat(page, 'JPG'); // pinned: the tab default became Auto
	await setTargetKb(page, 500); // input is ~10 KB — original already fits
	const run = await compress(page);
	expect(run.warnings).toEqual([]);
	const art = await downloadRow(page);
	expect(art.bytes.length, 'keep-original: byte-identical').toBe(input.length);
	expect(art.bytes.equals(input), 'keep-original: same bytes').toBe(true);
	rec.record({
		id: 'T-04',
		settings: { tab: 'jpg', mode: 'target', targetKb: 500 },
		input: { name: 'tiny-optimized.jpg', bytes: input.length },
		output: { name: art.name, bytes: art.bytes.length },
		metrics: { keptOriginal: true },
		assets: {
			original: rec.saveAsset('T-04', 'original', 'tiny-optimized.jpg', fx('tiny-optimized.jpg')),
			output: rec.saveAsset('T-04', 'output', art.name, art.bytes)
		}
	});
});

test('T-05: GIF output hides the target-size mode', async ({ page }) => {
	await gotoTab(page, 'jpg');
	await upload(page, fx('photo-1200x800.jpg'));
	await expect(page.locator('button[data-seg="target"]')).toHaveCount(1);
	await setOutputFormat(page, 'GIF');
	await expect(page.locator('button[data-seg="target"]')).toHaveCount(0);
	await setOutputFormat(page, 'JPG');
	await expect(page.locator('button[data-seg="target"]')).toHaveCount(1);
});

test('T-06: downscale-to-target rescues an unreachable target @slow', async ({ page, rec }) => {
	// 12 MP fixture: two full runs (quality-only ladder + downscale ladder,
	// each attempt re-decodes 12 MP) — the slowest image test by design.
	test.setTimeout(480_000);
	const input = readFileSync(fx('photo-4000x3000.jpg'));
	const targetKb = 30;
	await gotoTab(page, 'jpg');
	await upload(page, fx('photo-4000x3000.jpg'));
	await setOutputFormat(page, 'JPG'); // pinned: the tab default became Auto
	await setTargetKb(page, targetKb);

	// Premise guard: quality alone must NOT reach this target on the 12 MP
	// source — if this fails, the fixture got easier and the target needs
	// lowering (full-size q5 must exceed 30 KB).
	const off = await compress(page, { timeout: 200_000 });
	expect(off.warnings.join('\n'), 'premise: out of quality-only reach').toMatch(/not reachable/i);

	await toggle(page, 'Allow downscaling', true);
	const on = await compress(page, { timeout: 200_000 });
	expect(on.warnings, 'downscale reaches the target — no warning').toEqual([]);
	const art = await downloadRow(page);
	expect(art.bytes.length, `fits under ${targetKb} KB`).toBeLessThanOrEqual(targetKb * 1000);
	const m = await imageMeta(art.bytes);
	expect(m.width, 'was downscaled').toBeLessThan(4000);
	expect(m.width, 'never below the 320 px floor').toBeGreaterThanOrEqual(320);
	expect(m.width / m.height, 'aspect preserved').toBeCloseTo(4 / 3, 1);
	await expect(page.getByTestId('row-info')).toHaveText(/Resized to \d+×\d+ to reach the target/);
	rec.record({
		id: 'T-06',
		settings: { tab: 'jpg', mode: 'target', targetKb, downscaleToTarget: true },
		input: { name: 'photo-4000x3000.jpg', bytes: input.length },
		output: { name: art.name, bytes: art.bytes.length, width: m.width, height: m.height },
		note: 'Quality ladder alone warns; with the toggle the image lands under target at q75.',
		metrics: { targetBytes: targetKb * 1000, fits: art.bytes.length <= targetKb * 1000 },
		assets: {
			original: rec.saveAsset('T-06', 'original', 'photo-4000x3000.jpg', fx('photo-4000x3000.jpg')),
			output: rec.saveAsset('T-06', 'output', art.name, art.bytes)
		}
	});
});

test('T-07: the 320 px floor keeps absurd targets honestly unreachable @slow', async ({
	page,
	rec
}) => {
	test.setTimeout(300_000);
	await gotoTab(page, 'jpg');
	await upload(page, fx('photo-4000x3000.jpg'));
	await setOutputFormat(page, 'JPG'); // pinned: the tab default became Auto
	await setTargetKb(page, 1);
	await toggle(page, 'Allow downscaling', true);
	const run = await compress(page, { timeout: 200_000 });
	expect(run.warnings.join('\n'), 'still warns instead of producing a thumbnail').toMatch(
		/not reachable/i
	);
	const art = await downloadRow(page);
	const m = await imageMeta(art.bytes);
	expect(m.width, 'smallest attempt respects the floor').toBeGreaterThanOrEqual(320);
	expect(art.bytes.length, 'target truly missed').toBeGreaterThan(1000);
	rec.record({
		id: 'T-07',
		settings: { tab: 'jpg', mode: 'target', targetKb: 1, downscaleToTarget: true },
		input: { name: 'photo-4000x3000.jpg', bytes: readFileSync(fx('photo-4000x3000.jpg')).length },
		output: { name: art.name, bytes: art.bytes.length, width: m.width, height: m.height },
		warnings: run.warnings,
		metrics: { targetBytes: 1000, fits: false },
		assets: { output: rec.saveAsset('T-07', 'output', art.name, art.bytes) }
	});
});
