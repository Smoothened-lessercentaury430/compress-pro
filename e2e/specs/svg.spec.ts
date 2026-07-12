/**
 * S-01…09: SVGO option matrix + visual equivalence via sharp rasterization,
 * plus the raster outputs (SVG → PNG/ICO rendered in-app).
 */
import { readFileSync } from 'node:fs';
import sharp from 'sharp';
import { assertDiffBudget, assertFloor, expect, fx, test } from '../fixtures';
import {
	compress,
	downloadRow,
	gotoTab,
	setOutputFormat,
	setSvgPrecision,
	toggle,
	upload
} from '../helpers';
import { decodeRaw, icoInfo, imageMeta, pixelDiff, qualityMetrics } from '../verify';
import { DIFF_BUDGET, PSNR_FLOOR } from '../thresholds';

async function rasterize(svg: Buffer, w: number, h: number): Promise<Buffer> {
	return sharp(svg).resize(w, h, { fit: 'fill' }).png().toBuffer();
}

test('S-01: bloated svg default pass strips comments/metadata, stays visually equal @smoke', async ({
	page,
	rec
}) => {
	const input = readFileSync(fx('bloated.svg'));
	await gotoTab(page, 'svg');
	await upload(page, fx('bloated.svg'));
	const run = await compress(page);
	expect(run.warnings).toEqual([]);
	const art = await downloadRow(page);
	const text = art.bytes.toString('utf8');
	expect(text, 'comments stripped').not.toContain('<!--');
	expect(text, 'metadata stripped').not.toContain('<metadata');
	expect(art.bytes.length, 'meaningfully smaller').toBeLessThan(input.length * 0.7);

	const before = await rasterize(input, 800, 600);
	const after = await rasterize(art.bytes, 800, 600);
	const { ratio, diffPng, psnr } = await qualityMetrics(before, after);
	assertDiffBudget(ratio, DIFF_BUDGET.svg, 'S-01 rasterized');
	assertFloor(psnr, PSNR_FLOOR.svg, 'S-01 rasterized psnr');
	rec.record({
		id: 'S-01',
		settings: { tab: 'svg', defaults: true },
		input: { name: 'bloated.svg', bytes: input.length },
		output: { name: art.name, bytes: art.bytes.length },
		metrics: {
			diffRatio: Number(ratio.toFixed(5)),
			savingsPct: Number((((input.length - art.bytes.length) / input.length) * 100).toFixed(1))
		},
		assets: {
			original: rec.saveAsset('S-01', 'original', 'before.png', before),
			output: rec.saveAsset('S-01', 'output', 'after.png', after),
			diff: rec.saveAsset('S-01', 'diff', 'diff.png', diffPng)
		}
	});
});

test('S-02: removeDimensions drops width/height but keeps viewBox', async ({ page, rec }) => {
	await gotoTab(page, 'svg');
	await upload(page, fx('bloated.svg'));
	await toggle(page, 'Remove dimensions (keep viewBox)', true);
	await compress(page);
	const art = await downloadRow(page);
	const root = art.bytes.toString('utf8').match(/<svg[^>]*>/)?.[0] ?? '';
	expect(root, 'width attr removed').not.toMatch(/\swidth=/);
	expect(root, 'height attr removed').not.toMatch(/\sheight=/);
	expect(root, 'viewBox kept').toMatch(/viewBox=/);
	rec.record({
		id: 'S-02',
		settings: { tab: 'svg', removeDimensions: true },
		input: { name: 'bloated.svg', bytes: readFileSync(fx('bloated.svg')).length },
		output: { name: art.name, bytes: art.bytes.length },
		assets: { output: rec.saveAsset('S-02', 'output', art.name, art.bytes) }
	});
});

test('S-03: precision 1 truncates path/attribute decimals', async ({ page, rec }) => {
	await gotoTab(page, 'svg');
	await upload(page, fx('bloated.svg'));
	await setSvgPrecision(page, 1);
	await compress(page);
	const art = await downloadRow(page);
	const text = art.bytes.toString('utf8');
	// Precision governs geometry (path data); style-attr values are out of scope.
	const dAttrs = [...text.matchAll(/\sd="([^"]+)"/g)].map((m) => m[1]);
	expect(dAttrs.length).toBeGreaterThan(0);
	for (const d of dAttrs) {
		expect(d, 'path data keeps ≤1 decimal at precision 1').not.toMatch(/\d\.\d{2,}/);
	}
	rec.record({
		id: 'S-03',
		settings: { tab: 'svg', precision: 1 },
		input: { name: 'bloated.svg', bytes: readFileSync(fx('bloated.svg')).length },
		output: { name: art.name, bytes: art.bytes.length },
		assets: { output: rec.saveAsset('S-03', 'output', art.name, art.bytes) }
	});
});

test('S-04: everything off keeps comments intact', async ({ page, rec }) => {
	await gotoTab(page, 'svg');
	await upload(page, fx('bloated.svg'));
	await toggle(page, 'Remove comments', false);
	await toggle(page, 'Remove metadata', false);
	await toggle(page, 'Clean up IDs', false);
	await setSvgPrecision(page, 8);
	await compress(page);
	const art = await downloadRow(page);
	const text = art.bytes.toString('utf8');
	expect(text, 'comments preserved when disabled').toContain('<!--');
	expect(text, 'metadata preserved when disabled').toContain('<metadata');
	rec.record({
		id: 'S-04',
		settings: {
			tab: 'svg',
			removeComments: false,
			removeMetadata: false,
			cleanupIds: false,
			precision: 8
		},
		input: { name: 'bloated.svg', bytes: readFileSync(fx('bloated.svg')).length },
		output: { name: art.name, bytes: art.bytes.length },
		assets: { output: rec.saveAsset('S-04', 'output', art.name, art.bytes) }
	});
});

test('S-05: aggressive pass stays visually equivalent', async ({ page, rec }) => {
	const input = readFileSync(fx('bloated.svg'));
	await gotoTab(page, 'svg');
	await upload(page, fx('bloated.svg'));
	await toggle(page, 'Aggressive optimizations', true);
	await compress(page);
	const art = await downloadRow(page);
	const before = await rasterize(input, 800, 600);
	const after = await rasterize(art.bytes, 800, 600);
	const { ratio, diffPng } = await pixelDiff(before, after);
	assertDiffBudget(ratio, DIFF_BUDGET.svg, 'S-05 aggressive rasterized');
	expect(art.bytes.length).toBeLessThan(input.length * 0.7);
	rec.record({
		id: 'S-05',
		settings: { tab: 'svg', aggressive: true },
		input: { name: 'bloated.svg', bytes: input.length },
		output: { name: art.name, bytes: art.bytes.length },
		metrics: { diffRatio: Number(ratio.toFixed(5)) },
		assets: {
			original: rec.saveAsset('S-05', 'original', 'before.png', before),
			output: rec.saveAsset('S-05', 'output', 'after.png', after),
			diff: rec.saveAsset('S-05', 'diff', 'diff.png', diffPng)
		}
	});
});

test('S-06: an already-minimal icon never grows', async ({ page, rec }) => {
	const input = readFileSync(fx('clean-icon.svg'));
	await gotoTab(page, 'svg');
	await upload(page, fx('clean-icon.svg'));
	await compress(page);
	const art = await downloadRow(page);
	expect(art.bytes.length).toBeLessThanOrEqual(input.length);
	const before = await rasterize(input, 240, 240);
	const after = await rasterize(art.bytes, 240, 240);
	const { ratio } = await pixelDiff(before, after);
	assertDiffBudget(ratio, DIFF_BUDGET.svg, 'S-06 icon rasterized');
	rec.record({
		id: 'S-06',
		settings: { tab: 'svg', defaults: true },
		input: { name: 'clean-icon.svg', bytes: input.length },
		output: { name: art.name, bytes: art.bytes.length },
		metrics: { diffRatio: Number(ratio.toFixed(5)) },
		assets: {
			original: rec.saveAsset('S-06', 'original', 'before.png', before),
			output: rec.saveAsset('S-06', 'output', 'after.png', after)
		}
	});
});

test('S-07: svg → png renders at rasterSize with the vector look preserved', async ({
	page,
	rec
}) => {
	const input = readFileSync(fx('bloated.svg'));
	await gotoTab(page, 'svg');
	await upload(page, fx('bloated.svg'));
	await setOutputFormat(page, 'PNG');
	const run = await compress(page);
	expect(run.warnings).toEqual([]);
	const art = await downloadRow(page);
	expect(art.name).toBe('bloated.png');
	const meta = await imageMeta(art.bytes);
	expect(meta.format).toBe('png');
	// 800×600 source at the default 1024 px longest side keeps the aspect.
	expect([meta.width, meta.height]).toEqual([1024, 768]);

	// Cross-rasterizer compare (Chromium canvas vs sharp/librsvg) — the
	// dedicated svgRender budgets carry the anti-aliasing divergence.
	const reference = await sharp(input).resize(1024, 768, { fit: 'fill' }).png().toBuffer();
	const { ratio, diffPng, psnr } = await qualityMetrics(reference, art.bytes);
	assertDiffBudget(ratio, DIFF_BUDGET.svgRender, 'S-07 render');
	assertFloor(psnr, PSNR_FLOOR.svgRender, 'S-07 render psnr');
	rec.record({
		id: 'S-07',
		settings: { tab: 'svg', output: 'png', rasterSize: 1024 },
		input: { name: 'bloated.svg', bytes: input.length },
		output: { name: art.name, bytes: art.bytes.length },
		metrics: { diffRatio: Number(ratio.toFixed(5)), psnr: Number(psnr.toFixed(1)) },
		assets: {
			original: rec.saveAsset('S-07', 'original', 'reference.png', reference),
			output: rec.saveAsset('S-07', 'output', art.name, art.bytes),
			diff: rec.saveAsset('S-07', 'diff', 'diff.png', diffPng)
		}
	});
});

test('S-08: svg → ico muxes vector-rendered favicon sizes with transparency', async ({
	page,
	rec
}) => {
	await gotoTab(page, 'svg');
	await upload(page, fx('clean-icon.svg'));
	await setOutputFormat(page, 'ICO');
	const run = await compress(page);
	expect(run.warnings).toEqual([]);
	const art = await downloadRow(page);
	expect(art.name).toBe('clean-icon.ico');
	const ico = icoInfo(art.bytes);
	// The vector renders at a 256 px square — every standard size fits.
	expect(ico.count).toBe(5);
	expect(ico.sizes).toContain(16);
	expect(ico.sizes).toContain(256);
	for (const entry of ico.entries) expect(entry.isPng, `${entry.size}px entry is PNG`).toBe(true);
	// clean-icon has no background — the rendered icon must stay transparent.
	const small = ico.entries.find((e) => e.size === 32);
	const raw = await decodeRaw(small!.bytes);
	let transparent = 0;
	for (let i = 3; i < raw.data.length; i += 4) if (raw.data[i] === 0) transparent++;
	expect(transparent, 'transparent background preserved').toBeGreaterThan(0);
	rec.record({
		id: 'S-08',
		settings: { tab: 'svg', output: 'ico' },
		input: { name: 'clean-icon.svg', bytes: readFileSync(fx('clean-icon.svg')).length },
		output: { name: art.name, bytes: art.bytes.length },
		metrics: { entries: ico.count, sizes: ico.sizes.join('/') },
		assets: { output: rec.saveAsset('S-08', 'output', art.name, art.bytes) }
	});
});

test('S-09: the size input drives the rendered PNG dimensions', async ({ page }) => {
	await gotoTab(page, 'svg');
	await upload(page, fx('bloated.svg'));
	await setOutputFormat(page, 'PNG');
	await page.locator('#raster-size').fill('512');
	await compress(page);
	const art = await downloadRow(page);
	const meta = await imageMeta(art.bytes);
	expect([meta.width, meta.height]).toEqual([512, 384]);
});
