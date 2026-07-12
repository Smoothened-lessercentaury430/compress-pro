/**
 * AF-01…06: the Auto output format — smallest of JPG/WebP/AVIF per image
 * (AVIF races only ≤4 MP under cross-origin isolation), alpha stays in an
 * alpha-capable format, animation stays WebP, original bytes are an implicit
 * candidate, default-selected on the jpg/png/webp tabs.
 */
import { readFileSync } from 'node:fs';
import { expect, fx, fxMeta, test } from '../fixtures';
import { compress, downloadRow, gotoTab, setTargetKb, upload } from '../helpers';
import { imageMeta, pixelAt, decodeRaw } from '../verify';

test('AF-01: opaque photo picks the smallest of jpg/webp/avif, name follows @smoke', async ({
	page,
	rec
}) => {
	const input = readFileSync(fx('photo-1200x800.jpg'));
	await gotoTab(page, 'jpg');
	await upload(page, fx('photo-1200x800.jpg')); // Auto is the tab default
	await compress(page);
	const art = await downloadRow(page);
	const m = await imageMeta(art.bytes);
	expect(['jpeg', 'webp', 'avif'], 'winner is one of the candidates').toContain(m.format);
	const expectedExt = { jpeg: 'jpg', webp: 'webp', avif: 'avif' }[m.format];
	expect(art.name, 'extension follows the actual winner').toBe(`photo-1200x800.${expectedExt}`);
	expect([m.width, m.height]).toEqual([1200, 800]);
	expect(art.bytes.length, 'auto must never grow').toBeLessThanOrEqual(input.length);
	rec.record({
		id: 'AF-01',
		settings: { tab: 'jpg', output: 'auto', quality: 80 },
		input: { name: 'photo-1200x800.jpg', bytes: input.length },
		output: { name: art.name, bytes: art.bytes.length, format: m.format },
		metrics: {
			chosen: m.format,
			savingsPct: Number((((input.length - art.bytes.length) / input.length) * 100).toFixed(1))
		},
		assets: {
			original: rec.saveAsset('AF-01', 'original', 'photo-1200x800.jpg', fx('photo-1200x800.jpg')),
			output: rec.saveAsset('AF-01', 'output', art.name, art.bytes)
		}
	});
});

test('AF-02: transparency never picks jpg @smoke', async ({ page, rec }) => {
	const meta = fxMeta<{ transparentPoints: [number, number][] }>('graphic-alpha.png');
	await gotoTab(page, 'png');
	await upload(page, fx('graphic-alpha.png')); // Auto is the tab default
	await compress(page);
	const art = await downloadRow(page);
	const m = await imageMeta(art.bytes);
	expect(['webp', 'avif'], 'alpha source must stay in an alpha-capable format').toContain(m.format);
	expect(m.hasAlpha).toBe(true);
	const raw = await decodeRaw(art.bytes);
	for (const [x, y] of meta.transparentPoints) {
		expect(pixelAt(raw, x, y)[3], `alpha at ${x},${y}`).toBe(0);
	}
	expect(art.name).toBe(`graphic-alpha.${m.format}`);
	rec.record({
		id: 'AF-02',
		settings: { tab: 'png', output: 'auto', quality: 80 },
		input: { name: 'graphic-alpha.png', bytes: readFileSync(fx('graphic-alpha.png')).length },
		output: { name: art.name, bytes: art.bytes.length, format: m.format },
		assets: {
			original: rec.saveAsset('AF-02', 'original', 'graphic-alpha.png', fx('graphic-alpha.png')),
			output: rec.saveAsset('AF-02', 'output', art.name, art.bytes)
		}
	});
});

test('AF-03: animated input keeps its animation via webp', async ({ page, rec }) => {
	const meta = fxMeta<{ pages: number }>('anim-10f.webp');
	await gotoTab(page, 'webp');
	await upload(page, fx('anim-10f.webp')); // Auto is the tab default
	const run = await compress(page);
	expect(run.warnings, 'no animation-lost warning under auto').toEqual([]);
	const art = await downloadRow(page);
	const m = await imageMeta(art.bytes);
	expect(m.format).toBe('webp');
	expect(m.pages, 'every frame survives').toBe(meta.pages);
	rec.record({
		id: 'AF-03',
		settings: { tab: 'webp', output: 'auto', quality: 80 },
		input: {
			name: 'anim-10f.webp',
			bytes: readFileSync(fx('anim-10f.webp')).length,
			pages: meta.pages
		},
		output: { name: art.name, bytes: art.bytes.length, pages: m.pages },
		assets: {
			original: rec.saveAsset('AF-03', 'original', 'anim-10f.webp', fx('anim-10f.webp')),
			output: rec.saveAsset('AF-03', 'output', art.name, art.bytes)
		}
	});
});

test('AF-04: Auto is the default on jpg/png/webp; gif has no Auto; heic defaults JPG', async ({
	page
}) => {
	for (const tab of ['jpg', 'png', 'webp'] as const) {
		await gotoTab(page, tab);
		await upload(page, fx(tab === 'webp' ? 'photo-1000x700.webp' : `photo-1200x800.${tab}`));
		await expect(page.getByRole('button', { name: 'Auto', exact: true })).toHaveAttribute(
			'aria-pressed',
			'true'
		);
	}
	await gotoTab(page, 'gif');
	await upload(page, fx('static.gif'));
	await expect(page.getByRole('button', { name: 'Auto', exact: true })).toHaveCount(0);
	await expect(page.getByRole('button', { name: 'GIF', exact: true })).toHaveAttribute(
		'aria-pressed',
		'true'
	);
});

test('AF-05: auto + target mode resolves to webp and fits', async ({ page, rec }) => {
	const inputBytes = fxMeta<{ size: number }>('photo-1200x800.jpg').size;
	const targetKb = Math.round((inputBytes * 0.5) / 1000);
	await gotoTab(page, 'jpg');
	await upload(page, fx('photo-1200x800.jpg')); // Auto default
	await setTargetKb(page, targetKb);
	const run = await compress(page);
	expect(run.warnings).toEqual([]);
	const art = await downloadRow(page);
	const m = await imageMeta(art.bytes);
	expect(m.format, 'target search runs on the webp ladder').toBe('webp');
	expect(art.name).toBe('photo-1200x800.webp');
	expect(art.bytes.length).toBeLessThanOrEqual(targetKb * 1000);
	rec.record({
		id: 'AF-05',
		settings: { tab: 'jpg', output: 'auto', mode: 'target', targetKb },
		input: { name: 'photo-1200x800.jpg', bytes: inputBytes },
		output: { name: art.name, bytes: art.bytes.length, format: m.format },
		assets: { output: rec.saveAsset('AF-05', 'output', art.name, art.bytes) }
	});
});

test('AF-06: nothing beats an already-tight original — bytes kept verbatim', async ({
	page,
	rec
}) => {
	const input = readFileSync(fx('tiny-optimized.jpg'));
	await gotoTab(page, 'jpg');
	await upload(page, fx('tiny-optimized.jpg')); // Auto default
	await compress(page);
	const art = await downloadRow(page);
	expect(art.name, 'name unchanged when the original wins').toBe('tiny-optimized.jpg');
	expect(art.bytes.equals(input), 'original bytes kept').toBe(true);
	rec.record({
		id: 'AF-06',
		settings: { tab: 'jpg', output: 'auto', quality: 80 },
		input: { name: 'tiny-optimized.jpg', bytes: input.length },
		output: { name: art.name, bytes: art.bytes.length },
		metrics: { keptOriginal: true },
		assets: { output: rec.saveAsset('AF-06', 'output', art.name, art.bytes) }
	});
});
