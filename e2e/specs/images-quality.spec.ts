/**
 * Q-01…07: quality ladder monotonicity (bytes, diff ratio AND PSNR), PNG q100
 * losslessness, WebP q100 losslessness for lossless sources, PNG quantize,
 * extreme q1, slider canary.
 */
import { readFileSync } from 'node:fs';
import { assertDiffBudget, assertFloor, expect, fx, test } from '../fixtures';
import { compress, downloadRow, gotoTab, setOutputFormat, setQuality, upload } from '../helpers';
import { imageMeta, isPixelIdentical, qualityMetrics, uniqueColorCount } from '../verify';
import { DIFF_BUDGET, PSNR_FLOOR } from '../thresholds';

test('Q-01: jpg quality ladder 30/60/90 — size up, artifacts down @smoke', async ({
	page,
	rec
}) => {
	const input = readFileSync(fx('photo-1200x800.jpg'));
	await gotoTab(page, 'jpg');
	await upload(page, fx('photo-1200x800.jpg'));

	const results: { q: number; bytes: number; ratio: number; psnr: number }[] = [];
	for (const q of [30, 60, 90]) {
		await setQuality(page, q);
		await compress(page);
		const art = await downloadRow(page);
		const { ratio, diffPng, psnr } = await qualityMetrics(input, art.bytes);
		results.push({ q, bytes: art.bytes.length, ratio, psnr });
		rec.record({
			id: `Q-01-q${q}`,
			settings: { tab: 'jpg', output: 'jpg', quality: q },
			input: { name: 'photo-1200x800.jpg', bytes: input.length },
			output: { name: art.name, bytes: art.bytes.length },
			metrics: { diffRatio: Number(ratio.toFixed(5)), psnr: Number(psnr.toFixed(1)) },
			assets: {
				original: rec.saveAsset(
					`Q-01-q${q}`,
					'original',
					'photo-1200x800.jpg',
					fx('photo-1200x800.jpg')
				),
				output: rec.saveAsset(`Q-01-q${q}`, 'output', `q${q}-${art.name}`, art.bytes),
				diff: rec.saveAsset(`Q-01-q${q}`, 'diff', 'diff.png', diffPng)
			}
		});
	}
	const [q30, q60, q90] = results;
	expect(q30.bytes, 'q30 ≤ q60 bytes').toBeLessThanOrEqual(q60.bytes);
	expect(q60.bytes, 'q60 ≤ q90 bytes').toBeLessThanOrEqual(q90.bytes);
	expect(q90.ratio, 'q90 cleanest').toBeLessThanOrEqual(q60.ratio);
	expect(q60.ratio, 'q60 cleaner than q30').toBeLessThanOrEqual(q30.ratio);
	// PSNR must climb the ladder too — a deterministic quality staircase.
	expect(q60.psnr, 'q60 psnr above q30').toBeGreaterThanOrEqual(q30.psnr);
	expect(q90.psnr, 'q90 psnr above q60').toBeGreaterThanOrEqual(q60.psnr);
	assertDiffBudget(q30.ratio, DIFF_BUDGET.q30, 'Q-01 q30');
	assertDiffBudget(q90.ratio, DIFF_BUDGET.q90, 'Q-01 q90');
	assertFloor(q30.psnr, PSNR_FLOOR.q30, 'Q-01 q30 psnr');
	assertFloor(q90.psnr, PSNR_FLOOR.q90, 'Q-01 q90 psnr');
});

test('Q-02: png q100 is pixel-identical (oxipng lossless) @smoke', async ({ page, rec }) => {
	const input = readFileSync(fx('photo-1200x800.png'));
	await gotoTab(page, 'png');
	await upload(page, fx('photo-1200x800.png'));
	await setOutputFormat(page, 'PNG'); // pinned: the tab default became Auto
	await setQuality(page, 100);
	await compress(page);
	const art = await downloadRow(page);
	expect(await isPixelIdentical(input, art.bytes), 'q100 must be lossless').toBe(true);
	expect(art.bytes.length, 'lossless must not grow').toBeLessThanOrEqual(input.length);
	rec.record({
		id: 'Q-02',
		settings: { tab: 'png', output: 'png', quality: 100 },
		input: { name: 'photo-1200x800.png', bytes: input.length },
		output: { name: art.name, bytes: art.bytes.length },
		metrics: { diffRatio: 0, lossless: true },
		assets: {
			original: rec.saveAsset('Q-02', 'original', 'photo-1200x800.png', fx('photo-1200x800.png')),
			output: rec.saveAsset('Q-02', 'output', art.name, art.bytes)
		}
	});
});

test('Q-03: png q50 quantizes to ≤256 colors', async ({ page, rec }) => {
	const input = readFileSync(fx('photo-1200x800.png'));
	await gotoTab(page, 'png');
	await upload(page, fx('photo-1200x800.png'));
	await setOutputFormat(page, 'PNG'); // pinned: the tab default became Auto
	await setQuality(page, 50);
	await compress(page);
	const art = await downloadRow(page);
	const colors = await uniqueColorCount(art.bytes);
	expect(colors, 'libimagequant palette bound').toBeLessThanOrEqual(256);
	expect(art.bytes.length, 'quantized much smaller').toBeLessThan(input.length);
	const { ratio, diffPng, psnr } = await qualityMetrics(input, art.bytes);
	assertDiffBudget(ratio, DIFF_BUDGET.pngQuantized, 'Q-03 png q50');
	assertFloor(psnr, PSNR_FLOOR.pngQuantized, 'Q-03 png q50 psnr');
	rec.record({
		id: 'Q-03',
		settings: { tab: 'png', output: 'png', quality: 50 },
		input: { name: 'photo-1200x800.png', bytes: input.length },
		output: { name: art.name, bytes: art.bytes.length },
		metrics: {
			diffRatio: Number(ratio.toFixed(5)),
			psnr: Number(psnr.toFixed(1)),
			uniqueColors: colors
		},
		assets: {
			original: rec.saveAsset('Q-03', 'original', 'photo-1200x800.png', fx('photo-1200x800.png')),
			output: rec.saveAsset('Q-03', 'output', art.name, art.bytes),
			diff: rec.saveAsset('Q-03', 'diff', 'diff.png', diffPng)
		}
	});
});

test('Q-04: webp quality ladder 30/60/90 monotonic', async ({ page, rec }) => {
	const input = readFileSync(fx('photo-1000x700.webp'));
	await gotoTab(page, 'webp');
	await upload(page, fx('photo-1000x700.webp'));
	await setOutputFormat(page, 'WebP'); // pinned: the tab default became Auto
	const results: { q: number; bytes: number; ratio: number; psnr: number }[] = [];
	for (const q of [30, 60, 90]) {
		await setQuality(page, q);
		await compress(page);
		const art = await downloadRow(page);
		const { ratio, psnr } = await qualityMetrics(input, art.bytes);
		results.push({ q, bytes: art.bytes.length, ratio, psnr });
		rec.record({
			id: `Q-04-q${q}`,
			settings: { tab: 'webp', output: 'webp', quality: q },
			input: { name: 'photo-1000x700.webp', bytes: input.length },
			output: { name: art.name, bytes: art.bytes.length },
			metrics: { diffRatio: Number(ratio.toFixed(5)), psnr: Number(psnr.toFixed(1)) },
			assets: {
				original: rec.saveAsset(
					`Q-04-q${q}`,
					'original',
					'photo-1000x700.webp',
					fx('photo-1000x700.webp')
				),
				output: rec.saveAsset(`Q-04-q${q}`, 'output', `q${q}-${art.name}`, art.bytes)
			}
		});
	}
	expect(results[0].bytes).toBeLessThanOrEqual(results[1].bytes);
	expect(results[1].bytes).toBeLessThanOrEqual(results[2].bytes);
	expect(results[2].ratio).toBeLessThanOrEqual(results[0].ratio);
	expect(results[2].psnr, 'q90 psnr above q30').toBeGreaterThanOrEqual(results[0].psnr);
	assertFloor(results[0].psnr, PSNR_FLOOR.q30, 'Q-04 q30 psnr');
	assertFloor(results[2].psnr, PSNR_FLOOR.q90, 'Q-04 q90 psnr');
});

test('Q-05: q1 extreme still decodes with correct dimensions', async ({ page, rec }) => {
	await gotoTab(page, 'jpg');
	await upload(page, fx('photo-1200x800.jpg'));
	await setOutputFormat(page, 'JPG'); // pinned: the tab default became Auto
	await setQuality(page, 1);
	await compress(page);
	const art = await downloadRow(page);
	const m = await imageMeta(art.bytes);
	expect(m.format).toBe('jpeg');
	expect([m.width, m.height]).toEqual([1200, 800]);
	rec.record({
		id: 'Q-05',
		settings: { tab: 'jpg', output: 'jpg', quality: 1 },
		input: { name: 'photo-1200x800.jpg', bytes: readFileSync(fx('photo-1200x800.jpg')).length },
		output: { name: art.name, bytes: art.bytes.length },
		assets: {
			original: rec.saveAsset('Q-05', 'original', 'photo-1200x800.jpg', fx('photo-1200x800.jpg')),
			output: rec.saveAsset('Q-05', 'output', art.name, art.bytes)
		}
	});
});

test('Q-06: quality slider label echoes the bound value @smoke', async ({ page }) => {
	await gotoTab(page, 'jpg');
	await upload(page, fx('tiny-optimized.jpg')); // controls render once files exist
	// setQuality itself asserts the visible "37%" echo — a binding canary.
	await setQuality(page, 37);
	await setQuality(page, 80);
});

test('Q-07: webp q100 from a lossless (PNG) source is pixel-identical', async ({ page, rec }) => {
	const input = readFileSync(fx('photo-1200x800.png'));
	await gotoTab(page, 'png');
	await upload(page, fx('photo-1200x800.png'));
	await setOutputFormat(page, 'WebP');
	await setQuality(page, 100);
	await compress(page);
	const art = await downloadRow(page);
	const m = await imageMeta(art.bytes);
	expect(m.format).toBe('webp');
	expect(
		await isPixelIdentical(input, art.bytes),
		'q100 + lossless source must produce lossless webp (VP8L)'
	).toBe(true);
	rec.record({
		id: 'Q-07',
		settings: { tab: 'png', output: 'webp', quality: 100 },
		input: { name: 'photo-1200x800.png', bytes: input.length },
		output: { name: art.name, bytes: art.bytes.length },
		note: 'Lossy sources (jpg/avif/heic) deliberately stay on the lossy path at q100.',
		metrics: {
			savingsPct: Number((((input.length - art.bytes.length) / input.length) * 100).toFixed(1))
		},
		assets: { output: rec.saveAsset('Q-07', 'output', art.name, art.bytes) }
	});
});
