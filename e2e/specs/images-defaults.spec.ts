/**
 * IMG-01…24: every image input tab × every output format at default settings
 * (quality 80). Verifies download name, container format, dimensions, clean
 * decode, pixel-diff budget + PSNR/SSIM floors, and the same-format shrink
 * guarantee.
 */
import { readFileSync } from 'node:fs';
import { FIXTURES, assertDiffBudget, assertFloor, expect, fx, test } from '../fixtures';
import {
	compress,
	downloadRow,
	gotoTab,
	setOutputFormat,
	upload,
	type OutputPill,
	type Tab
} from '../helpers';
import { imageMeta, qualityMetrics } from '../verify';
import { DIFF_BUDGET, PSNR_FLOOR, SSIM_FLOOR } from '../thresholds';

const INPUTS: { tab: Tab; file: string; w: number; h: number }[] = [
	{ tab: 'jpg', file: 'photo-1200x800.jpg', w: 1200, h: 800 },
	{ tab: 'png', file: 'photo-1200x800.png', w: 1200, h: 800 },
	{ tab: 'webp', file: 'photo-1000x700.webp', w: 1000, h: 700 },
	{ tab: 'gif', file: 'static.gif', w: 256, h: 192 },
	{ tab: 'heic', file: 'iphone-photo.heic', w: 1200, h: 800 }
];

const OUTPUTS = ['jpg', 'png', 'webp', 'gif', 'avif'] as const;
const PILL: Record<string, OutputPill> = {
	jpg: 'JPG',
	png: 'PNG',
	webp: 'WebP',
	gif: 'GIF',
	avif: 'AVIF'
};
const SNIFFED: Record<string, string> = {
	jpg: 'jpeg',
	png: 'png',
	webp: 'webp',
	gif: 'gif',
	avif: 'avif'
};

function budgetFor(inputTab: string, out: string): number {
	let base: number = DIFF_BUDGET.q80;
	if (out === 'avif') base = DIFF_BUDGET.avif;
	if (out === 'gif') base = DIFF_BUDGET.gifOut;
	if (out === 'png') base = DIFF_BUDGET.pngQuantized;
	// A GIF source is already dithered — any lossy re-encode smooths that
	// dither away, which reads as a large pixel diff despite looking fine.
	if (inputTab === 'gif') base = Math.max(base, DIFF_BUDGET.gifOut);
	// HEIC baselines carry sips' own HEVC loss on top of the output codec's.
	if (inputTab === 'heic') base = Math.max(base, DIFF_BUDGET.heicSource);
	return base;
}

// PSNR/SSIM floors compose like budgetFor but in the opposite direction:
// lower floor = looser, so tier mixing takes Math.min.
function psnrFloorFor(inputTab: string, out: string): number {
	let base: number = PSNR_FLOOR.q80;
	if (out === 'avif') base = PSNR_FLOOR.avif;
	if (out === 'gif') base = PSNR_FLOOR.gifOut;
	if (out === 'png') base = PSNR_FLOOR.pngQuantized;
	if (inputTab === 'gif') base = Math.min(base, PSNR_FLOOR.gifOut);
	if (inputTab === 'heic') base = Math.min(base, PSNR_FLOOR.heicSource);
	return base;
}

function ssimFloorFor(inputTab: string, out: string): number {
	let base: number = SSIM_FLOOR.q80;
	if (out === 'gif') base = SSIM_FLOOR.gifOut;
	if (out === 'png') base = SSIM_FLOOR.pngQuantized;
	if (inputTab === 'gif') base = Math.min(base, SSIM_FLOOR.gifOut);
	if (inputTab === 'heic') base = Math.min(base, SSIM_FLOOR.heicSource);
	return base;
}

let n = 0;
for (const input of INPUTS) {
	for (const out of OUTPUTS) {
		if (input.tab === 'heic' && out === 'gif') continue; // GIF pill absent for HEIC
		n++;
		const id = `IMG-${String(n).padStart(2, '0')}`;
		const smoke =
			(input.tab === out && ['jpg', 'png', 'webp'].includes(out)) ||
			(input.tab === 'heic' && out === 'jpg');
		test(`${id}: ${input.file} → ${out} (q80)${smoke ? ' @smoke' : ''}`, async ({ page, rec }) => {
			test.skip(input.tab === 'heic' && !FIXTURES.heicAvailable, 'sips HEIC fixture unavailable');

			await gotoTab(page, input.tab);
			await upload(page, fx(input.file));
			await setOutputFormat(page, PILL[out]);
			const run = await compress(page);

			const art = await downloadRow(page);
			const stem = input.file.replace(/\.[^.]+$/, '');
			expect(art.name, `${id} download filename`).toBe(`${stem}.${out}`);

			const m = await imageMeta(art.bytes); // throws on garbage = decode check
			expect(m.format, `${id} container format`).toBe(SNIFFED[out]);
			expect([m.width, m.height], `${id} dimensions`).toEqual([input.w, input.h]);

			// Quality vs the REAL source — decodeRaw handles HEIC via icodec, so
			// heic rows are asserted like everything else (heicSource tiers). The
			// ratio stays the regression gate; PSNR/SSIM floors catch uniform
			// degradation (banding, over-smoothing) the ratio can't see.
			const isHeic = input.tab === 'heic';
			const origBuf = readFileSync(fx(input.file));
			const { ratio, diffPng, psnr, ssim } = await qualityMetrics(origBuf, art.bytes, {
				ssim: true
			});
			assertDiffBudget(ratio, budgetFor(input.tab, out), `${id} ${input.file}→${out}`);
			assertFloor(psnr, psnrFloorFor(input.tab, out), `${id} psnr`);
			assertFloor(ssim ?? 0, ssimFloorFor(input.tab, out), `${id} ssim`);

			// Same-format recompress must never grow (keep-original guard backs this).
			const inputBytes = readFileSync(fx(input.file)).length;
			if (input.tab === out) {
				expect(art.bytes.length, `${id} same-format must not grow`).toBeLessThanOrEqual(inputBytes);
			}

			rec.record({
				id,
				settings: { tab: input.tab, output: out, quality: 80, mode: 'quality' },
				input: { name: input.file, bytes: inputBytes, width: input.w, height: input.h },
				output: {
					name: art.name,
					bytes: art.bytes.length,
					width: m.width,
					height: m.height,
					format: m.format
				},
				metrics: {
					diffRatio: Number(ratio.toFixed(5)),
					psnr: Number(psnr.toFixed(1)),
					ssim: ssim === null ? null : Number(ssim.toFixed(4)),
					savingsPct: Number((((inputBytes - art.bytes.length) / inputBytes) * 100).toFixed(1)),
					keptOriginal: input.tab === out && art.bytes.length === inputBytes
				},
				warnings: run.warnings,
				assets: {
					original: rec.saveAsset(
						id,
						'original',
						isHeic ? 'iphone-photo.heic.preview.png' : input.file,
						isHeic ? fx('iphone-photo.heic.preview.png') : fx(input.file)
					),
					output: rec.saveAsset(id, 'output', art.name, art.bytes),
					diff: rec.saveAsset(id, 'diff', 'diff.png', diffPng)
				}
			});
		});
	}
}
