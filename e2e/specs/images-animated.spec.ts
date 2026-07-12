/**
 * AN-01…10: animation preservation (gif→gif, →webp, apng→webp), the GIF-only
 * ≤10 ms delay bump, animation-lost warnings for static outputs, gifsicle
 * color budget.
 */
import { readFileSync } from 'node:fs';
import { assertDiffBudget, expect, fx, fxMeta, test } from '../fixtures';
import { compress, downloadRow, gotoTab, setOutputFormat, setQuality, upload } from '../helpers';
import { imageMeta, pixelDiff, uniqueColorCount } from '../verify';
import { DIFF_BUDGET } from '../thresholds';

test('AN-01: gif→gif keeps frames, delays, and shrinks @smoke', async ({ page, rec }) => {
	const input = readFileSync(fx('anim-12f.gif'));
	const meta = fxMeta<{ pages: number }>('anim-12f.gif');
	await gotoTab(page, 'gif');
	await upload(page, fx('anim-12f.gif'));
	const run = await compress(page);
	expect(run.warnings).toEqual([]);
	const art = await downloadRow(page);
	const m = await imageMeta(art.bytes);
	expect(m.format).toBe('gif');
	expect(m.pages, 'frame count preserved').toBe(meta.pages);
	expect(m.delay, 'delays preserved').toEqual(Array(meta.pages).fill(80));
	expect(art.bytes.length, 'gifsicle should shrink').toBeLessThan(input.length);
	rec.record({
		id: 'AN-01',
		settings: { tab: 'gif', output: 'gif', quality: 80 },
		input: { name: 'anim-12f.gif', bytes: input.length, pages: meta.pages },
		output: { name: art.name, bytes: art.bytes.length, pages: m.pages },
		metrics: {
			savingsPct: Number((((input.length - art.bytes.length) / input.length) * 100).toFixed(1))
		},
		assets: {
			original: rec.saveAsset('AN-01', 'original', 'anim-12f.gif', fx('anim-12f.gif')),
			output: rec.saveAsset('AN-01', 'output', art.name, art.bytes)
		}
	});
});

test('AN-02: gif→webp keeps the animation', async ({ page, rec }) => {
	const input = readFileSync(fx('anim-12f.gif'));
	const meta = fxMeta<{ pages: number }>('anim-12f.gif');
	await gotoTab(page, 'gif');
	await upload(page, fx('anim-12f.gif'));
	await setOutputFormat(page, 'WebP');
	const run = await compress(page);
	expect(run.warnings, 'gif→webp preserves animation, no warning').toEqual([]);
	const art = await downloadRow(page);
	expect(art.name).toBe('anim-12f.webp');
	const m = await imageMeta(art.bytes);
	expect(m.format).toBe('webp');
	expect(m.pages, 'all frames re-encoded').toBe(meta.pages);
	for (const d of m.delay ?? []) {
		expect(d, '80 ms delays carried over').toBeGreaterThanOrEqual(70);
		expect(d).toBeLessThanOrEqual(110);
	}
	rec.record({
		id: 'AN-02',
		settings: { tab: 'gif', output: 'webp', quality: 80 },
		input: { name: 'anim-12f.gif', bytes: input.length, pages: meta.pages },
		output: { name: art.name, bytes: art.bytes.length, pages: m.pages },
		metrics: { delays: JSON.stringify(m.delay?.slice(0, 3)) },
		assets: {
			original: rec.saveAsset('AN-02', 'original', 'anim-12f.gif', fx('anim-12f.gif')),
			output: rec.saveAsset('AN-02', 'output', art.name, art.bytes)
		}
	});
});

test('AN-03: ≤10 ms gif delays are bumped to 100 ms in webp output', async ({ page, rec }) => {
	const meta = fxMeta<{ pages: number }>('anim-fast.gif');
	await gotoTab(page, 'gif');
	await upload(page, fx('anim-fast.gif'));
	await setOutputFormat(page, 'WebP');
	await compress(page);
	const art = await downloadRow(page);
	const m = await imageMeta(art.bytes);
	expect(m.pages).toBe(meta.pages);
	expect(m.delay, 'browser-hostile 10 ms delays normalized to 100 ms').toEqual(
		Array(meta.pages).fill(100)
	);
	rec.record({
		id: 'AN-03',
		settings: { tab: 'gif', output: 'webp', quality: 80 },
		input: {
			name: 'anim-fast.gif',
			bytes: readFileSync(fx('anim-fast.gif')).length,
			pages: meta.pages
		},
		output: { name: art.name, bytes: art.bytes.length, pages: m.pages },
		metrics: { delays: JSON.stringify(m.delay) },
		assets: {
			original: rec.saveAsset('AN-03', 'original', 'anim-fast.gif', fx('anim-fast.gif')),
			output: rec.saveAsset('AN-03', 'output', art.name, art.bytes)
		}
	});
});

for (const out of ['jpg', 'png', 'avif'] as const) {
	const pill = { jpg: 'JPG', png: 'PNG', avif: 'AVIF' } as const;
	test(`AN-04/05: animated gif → ${out} = first frame + warning`, async ({ page, rec }) => {
		const id = `AN-0${out === 'jpg' ? 4 : 5}-${out}`;
		const input = readFileSync(fx('anim-12f.gif'));
		await gotoTab(page, 'gif');
		await upload(page, fx('anim-12f.gif'));
		await setOutputFormat(page, pill[out]);
		const run = await compress(page);
		expect(run.warnings.join('\n')).toContain(
			`Animation lost — ${out.toUpperCase()} output keeps only the first frame`
		);
		const art = await downloadRow(page);
		const m = await imageMeta(art.bytes);
		expect(m.pages, 'single frame').toBe(1);
		// The kept frame must be frame 0 of the source.
		const { ratio, diffPng } = await pixelDiff(input, art.bytes, { origPage: 0 });
		assertDiffBudget(
			ratio,
			out === 'png' ? DIFF_BUDGET.pngQuantized : DIFF_BUDGET.q60,
			`${id} first frame`
		);
		rec.record({
			id,
			settings: { tab: 'gif', output: out, quality: 80 },
			input: { name: 'anim-12f.gif', bytes: input.length, pages: 12 },
			output: { name: art.name, bytes: art.bytes.length, pages: m.pages },
			warnings: run.warnings,
			metrics: { diffRatio: Number(ratio.toFixed(5)) },
			assets: {
				original: rec.saveAsset(id, 'original', 'anim-12f.gif', fx('anim-12f.gif')),
				output: rec.saveAsset(id, 'output', art.name, art.bytes),
				diff: rec.saveAsset(id, 'diff', 'diff.png', diffPng)
			}
		});
	});
}

test('AN-06: animated webp → webp keeps all frames without warning', async ({ page, rec }) => {
	const meta = fxMeta<{ pages: number }>('anim-10f.webp');
	await gotoTab(page, 'webp');
	await upload(page, fx('anim-10f.webp'));
	await setOutputFormat(page, 'WebP'); // pinned: the tab default became Auto
	const run = await compress(page);
	expect(run.warnings).toEqual([]);
	const art = await downloadRow(page);
	const m = await imageMeta(art.bytes);
	expect(m.format).toBe('webp');
	expect(m.pages, 'WebCodecs decode + re-mux keeps frames').toBe(meta.pages);
	rec.record({
		id: 'AN-06',
		settings: { tab: 'webp', output: 'webp', quality: 80 },
		input: {
			name: 'anim-10f.webp',
			bytes: readFileSync(fx('anim-10f.webp')).length,
			pages: meta.pages
		},
		output: { name: art.name, bytes: art.bytes.length, pages: m.pages },
		assets: {
			original: rec.saveAsset('AN-06', 'original', 'anim-10f.webp', fx('anim-10f.webp')),
			output: rec.saveAsset('AN-06', 'output', art.name, art.bytes)
		}
	});
});

test('AN-07: animated webp → png = first frame + warning', async ({ page, rec }) => {
	await gotoTab(page, 'webp');
	await upload(page, fx('anim-10f.webp'));
	await setOutputFormat(page, 'PNG');
	const run = await compress(page);
	expect(run.warnings.join('\n')).toContain(
		'Animation lost — PNG output keeps only the first frame'
	);
	const art = await downloadRow(page);
	const m = await imageMeta(art.bytes);
	expect(m.format).toBe('png');
	expect(m.pages).toBe(1);
	rec.record({
		id: 'AN-07',
		settings: { tab: 'webp', output: 'png', quality: 80 },
		input: { name: 'anim-10f.webp', bytes: readFileSync(fx('anim-10f.webp')).length, pages: 10 },
		output: { name: art.name, bytes: art.bytes.length, pages: m.pages },
		warnings: run.warnings,
		assets: {
			original: rec.saveAsset('AN-07', 'original', 'anim-10f.webp', fx('anim-10f.webp')),
			output: rec.saveAsset('AN-07', 'output', art.name, art.bytes)
		}
	});
});

test('AN-08: gif→gif q30 caps the palette at round(q/100·256)=77', async ({ page, rec }) => {
	await gotoTab(page, 'gif');
	await upload(page, fx('anim-12f.gif'));
	await setQuality(page, 30);
	await compress(page);
	const art = await downloadRow(page);
	const m = await imageMeta(art.bytes);
	expect(m.pages).toBe(12);
	const colors = await uniqueColorCount(art.bytes, 0);
	expect(colors, 'gifsicle --colors 77').toBeLessThanOrEqual(77);
	rec.record({
		id: 'AN-08',
		settings: { tab: 'gif', output: 'gif', quality: 30 },
		input: { name: 'anim-12f.gif', bytes: readFileSync(fx('anim-12f.gif')).length },
		output: { name: art.name, bytes: art.bytes.length, pages: m.pages },
		metrics: { uniqueColors: colors },
		assets: {
			original: rec.saveAsset('AN-08', 'original', 'anim-12f.gif', fx('anim-12f.gif')),
			output: rec.saveAsset('AN-08', 'output', art.name, art.bytes)
		}
	});
});

test('AN-09: APNG → webp keeps all frames; → jpg warns and keeps frame 1', async ({
	page,
	rec
}) => {
	const meta = fxMeta<{ pages: number }>('apng-3f.png');
	await gotoTab(page, 'png');
	await upload(page, fx('apng-3f.png'));
	await setOutputFormat(page, 'WebP');
	const run = await compress(page);
	expect(run.warnings, 'apng→webp preserves animation, no warning').toEqual([]);
	const art = await downloadRow(page);
	const m = await imageMeta(art.bytes);
	expect(m.format).toBe('webp');
	expect(m.pages, 'all APNG frames survive').toBe(meta.pages);

	await setOutputFormat(page, 'JPG');
	const second = await compress(page);
	expect(second.warnings.join('\n')).toContain(
		'Animation lost — JPG output keeps only the first frame'
	);
	const jpgArt = await downloadRow(page);
	expect((await imageMeta(jpgArt.bytes)).pages).toBe(1);
	rec.record({
		id: 'AN-09',
		settings: { tab: 'png', output: 'webp then jpg', quality: 80 },
		input: {
			name: 'apng-3f.png',
			bytes: readFileSync(fx('apng-3f.png')).length,
			pages: meta.pages
		},
		output: { name: art.name, bytes: art.bytes.length, pages: m.pages },
		note: 'APNG detected via acTL: animation carried into WebP, warned for static outputs.',
		assets: {
			original: rec.saveAsset('AN-09', 'original', 'apng-3f.png', fx('apng-3f.png')),
			output: rec.saveAsset('AN-09', 'output', art.name, art.bytes)
		}
	});
});

test('AN-10: ≤10 ms delays from a WEBP source are honored, not bumped', async ({ page, rec }) => {
	const meta = fxMeta<{ pages: number; delay: number[] }>('anim-fast.webp');
	await gotoTab(page, 'webp');
	await upload(page, fx('anim-fast.webp'));
	await setOutputFormat(page, 'WebP');
	await compress(page);
	const art = await downloadRow(page);
	const m = await imageMeta(art.bytes);
	expect(m.pages).toBe(meta.pages);
	for (const d of m.delay ?? []) {
		expect(d, 'WebP timing is real — the GIF 100 ms bump must not apply').toBeLessThanOrEqual(20);
	}
	rec.record({
		id: 'AN-10',
		settings: { tab: 'webp', output: 'webp', quality: 80 },
		input: {
			name: 'anim-fast.webp',
			bytes: readFileSync(fx('anim-fast.webp')).length,
			pages: meta.pages
		},
		output: { name: art.name, bytes: art.bytes.length, pages: m.pages },
		metrics: { delays: JSON.stringify(m.delay) },
		assets: {
			original: rec.saveAsset('AN-10', 'original', 'anim-fast.webp', fx('anim-fast.webp')),
			output: rec.saveAsset('AN-10', 'output', art.name, art.bytes)
		}
	});
});

test('AN-11: an animated gif wider than 16383 px clamps to the WebP cap, keeps frames', async ({
	page,
	rec
}) => {
	const meta = fxMeta<{ width: number; pages: number }>('anim-2f-16600x40.gif');
	await gotoTab(page, 'gif');
	await upload(page, fx('anim-2f-16600x40.gif'));
	await setOutputFormat(page, 'WebP');
	const run = await compress(page, { timeout: 120_000 });
	// The clamp preserves the animation — no "Animation lost" fallback allowed.
	expect(run.warnings.join(' '), 'must not fall back to the first frame').not.toMatch(
		/Animation lost|first frame/
	);
	const art = await downloadRow(page);
	const m = await imageMeta(art.bytes);
	expect(m.format).toBe('webp');
	expect(m.pages, 'both frames survive').toBe(meta.pages);
	expect(m.width, 'clamped under the container cap').toBeLessThanOrEqual(16383);
	expect(m.width, 'barely shrunk, not thumbnailed').toBeGreaterThan(16000);
	await expect(page.getByTestId('row-info')).toContainText('16383');
	rec.record({
		id: 'AN-11',
		settings: { tab: 'gif', output: 'webp', quality: 80 },
		input: {
			name: 'anim-2f-16600x40.gif',
			bytes: readFileSync(fx('anim-2f-16600x40.gif')).length,
			width: meta.width,
			pages: meta.pages
		},
		output: { name: art.name, bytes: art.bytes.length, width: m.width, pages: m.pages },
		note: 'Used to hard-fail: "Canvas 16600x40 exceeds WebP limits". Now clamps + says so.'
	});
});
