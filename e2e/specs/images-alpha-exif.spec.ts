/**
 * A-01…11: EXIF orientation, alpha handling across outputs (incl. GIF 1-bit
 * transparency), CMYK, 16-bit, interlaced/progressive inputs, wide-gamut
 * ICC disclosure.
 */
import { readFileSync } from 'node:fs';
import { expect, fx, fxMeta, test } from '../fixtures';
import {
	compress,
	downloadRow,
	gotoTab,
	rowByName,
	setOutputFormat,
	setQuality,
	upload
} from '../helpers';
import {
	decodeRaw,
	imageMeta,
	isPixelIdentical,
	pixelAt,
	pixelDiff,
	uniqueColorCount
} from '../verify';

type AlphaMeta = { transparentPoints: [number, number][]; opaquePoint: [number, number] };

test('A-01: EXIF orientation 6 is baked upright into the output @smoke', async ({ page, rec }) => {
	const meta = fxMeta<{
		displayWidth: number;
		displayHeight: number;
		markerPoint: [number, number];
	}>('photo-exif6.jpg');
	await gotoTab(page, 'jpg');
	await upload(page, fx('photo-exif6.jpg'));
	await setOutputFormat(page, 'JPG'); // pinned: the tab default became Auto
	await compress(page);
	const art = await downloadRow(page);
	const m = await imageMeta(art.bytes);
	expect([m.width, m.height], 'stored 900×600 must display-rotate to 600×900').toEqual([
		meta.displayWidth,
		meta.displayHeight
	]);
	const raw = await decodeRaw(art.bytes);
	const [r, g, b] = pixelAt(raw, meta.markerPoint[0], meta.markerPoint[1]);
	expect(r, 'red marker at visual top-left').toBeGreaterThan(150);
	expect(g).toBeLessThan(110);
	expect(b).toBeLessThan(110);
	rec.record({
		id: 'A-01',
		settings: { tab: 'jpg', output: 'jpg', quality: 80 },
		input: { name: 'photo-exif6.jpg', bytes: readFileSync(fx('photo-exif6.jpg')).length },
		output: { name: art.name, bytes: art.bytes.length, width: m.width, height: m.height },
		assets: {
			original: rec.saveAsset('A-01', 'original', 'photo-exif6.jpg', fx('photo-exif6.jpg')),
			output: rec.saveAsset('A-01', 'output', art.name, art.bytes)
		}
	});
});

test('A-02: transparent PNG → JPG flattens to WHITE @smoke', async ({ page, rec }) => {
	const meta = fxMeta<AlphaMeta>('graphic-alpha.png');
	await gotoTab(page, 'png');
	await upload(page, fx('graphic-alpha.png'));
	await setOutputFormat(page, 'JPG');
	await compress(page);
	const art = await downloadRow(page);
	const m = await imageMeta(art.bytes);
	expect(m.format).toBe('jpeg');
	const raw = await decodeRaw(art.bytes);
	for (const [x, y] of meta.transparentPoints) {
		const [r, g, b] = pixelAt(raw, x, y);
		// Desired: white background (like images→PDF's flatten), not mozjpeg black.
		expect(r, `bg at ${x},${y} should be white — got rgb(${r},${g},${b})`).toBeGreaterThanOrEqual(
			245
		);
		expect(g).toBeGreaterThanOrEqual(245);
		expect(b).toBeGreaterThanOrEqual(245);
	}
	rec.record({
		id: 'A-02',
		settings: { tab: 'png', output: 'jpg', quality: 80 },
		input: { name: 'graphic-alpha.png', bytes: readFileSync(fx('graphic-alpha.png')).length },
		output: { name: art.name, bytes: art.bytes.length },
		note: 'PNG alpha → JPG must flatten to white (consistent with images→PDF).',
		assets: {
			original: rec.saveAsset('A-02', 'original', 'graphic-alpha.png', fx('graphic-alpha.png')),
			output: rec.saveAsset('A-02', 'output', art.name, art.bytes)
		}
	});
});

test('A-03: alpha survives png → webp', async ({ page, rec }) => {
	const meta = fxMeta<AlphaMeta>('graphic-alpha.png');
	await gotoTab(page, 'png');
	await upload(page, fx('graphic-alpha.png'));
	await setOutputFormat(page, 'WebP');
	await compress(page);
	const art = await downloadRow(page);
	const m = await imageMeta(art.bytes);
	expect(m.format).toBe('webp');
	expect(m.hasAlpha, 'alpha channel preserved').toBe(true);
	const raw = await decodeRaw(art.bytes);
	for (const [x, y] of meta.transparentPoints) {
		expect(pixelAt(raw, x, y)[3], `alpha at ${x},${y}`).toBe(0);
	}
	rec.record({
		id: 'A-03',
		settings: { tab: 'png', output: 'webp', quality: 80 },
		input: { name: 'graphic-alpha.png', bytes: readFileSync(fx('graphic-alpha.png')).length },
		output: { name: art.name, bytes: art.bytes.length },
		assets: {
			original: rec.saveAsset('A-03', 'original', 'graphic-alpha.png', fx('graphic-alpha.png')),
			output: rec.saveAsset('A-03', 'output', art.name, art.bytes)
		}
	});
});

test('A-04: alpha survives png → png quantization', async ({ page, rec }) => {
	const meta = fxMeta<AlphaMeta>('graphic-alpha.png');
	await gotoTab(page, 'png');
	await upload(page, fx('graphic-alpha.png'));
	await setOutputFormat(page, 'PNG'); // pinned: the tab default became Auto
	await setQuality(page, 50);
	await compress(page);
	const art = await downloadRow(page);
	const m = await imageMeta(art.bytes);
	expect(m.hasAlpha).toBe(true);
	expect(await uniqueColorCount(art.bytes)).toBeLessThanOrEqual(256);
	const raw = await decodeRaw(art.bytes);
	for (const [x, y] of meta.transparentPoints) {
		expect(pixelAt(raw, x, y)[3], `alpha at ${x},${y}`).toBe(0);
	}
	rec.record({
		id: 'A-04',
		settings: { tab: 'png', output: 'png', quality: 50 },
		input: { name: 'graphic-alpha.png', bytes: readFileSync(fx('graphic-alpha.png')).length },
		output: { name: art.name, bytes: art.bytes.length },
		assets: {
			original: rec.saveAsset('A-04', 'original', 'graphic-alpha.png', fx('graphic-alpha.png')),
			output: rec.saveAsset('A-04', 'output', art.name, art.bytes)
		}
	});
});

test('A-05: lossless-alpha webp → png q100 keeps alpha exactly', async ({ page, rec }) => {
	await gotoTab(page, 'webp');
	await upload(page, fx('alpha-lossless.webp'));
	await setOutputFormat(page, 'PNG');
	await setQuality(page, 100);
	await compress(page);
	const art = await downloadRow(page);
	const m = await imageMeta(art.bytes);
	expect(m.format).toBe('png');
	expect(m.hasAlpha).toBe(true);
	// The canvas decode path premultiplies alpha, so color under alpha<255 loses
	// a rounding step — exact-match the alpha plane, budget the color planes.
	const orig = await decodeRaw(readFileSync(fx('alpha-lossless.webp')));
	const out = await decodeRaw(art.bytes);
	expect(out.data.length).toBe(orig.data.length);
	let alphaMismatches = 0;
	for (let i = 3; i < orig.data.length; i += 4) {
		if (orig.data[i] !== out.data[i]) alphaMismatches++;
	}
	expect(alphaMismatches, 'alpha plane must survive exactly').toBe(0);
	const { ratio } = await pixelDiff(readFileSync(fx('alpha-lossless.webp')), art.bytes);
	expect(ratio, 'colors near-identical (premultiply rounding only)').toBeLessThanOrEqual(0.01);
	rec.record({
		id: 'A-05',
		settings: { tab: 'webp', output: 'png', quality: 100 },
		input: { name: 'alpha-lossless.webp', bytes: readFileSync(fx('alpha-lossless.webp')).length },
		output: { name: art.name, bytes: art.bytes.length },
		metrics: { alphaExact: true },
		note: 'Canvas premultiply rounds colors under partial alpha — alpha plane exact, colors budgeted.',
		assets: {
			original: rec.saveAsset('A-05', 'original', 'alpha-lossless.webp', fx('alpha-lossless.webp')),
			output: rec.saveAsset('A-05', 'output', art.name, art.bytes)
		}
	});
});

test('A-06: CMYK JPEG decodes and re-encodes to sRGB', async ({ page, rec }) => {
	const input = readFileSync(fx('photo-cmyk.jpg'));
	await gotoTab(page, 'jpg');
	await upload(page, fx('photo-cmyk.jpg'));
	await setOutputFormat(page, 'JPG'); // pinned: the tab default became Auto
	await compress(page);
	const art = await downloadRow(page);
	const m = await imageMeta(art.bytes);
	expect(m.format).toBe('jpeg');
	expect([m.width, m.height]).toEqual([1000, 700]);
	expect(m.space, 'output must be sRGB, not CMYK').toBe('srgb');
	// Chromium's naive CMYK inversion and libvips' profile-based conversion are
	// legitimately different curves — a systematic mid-tone shift is expected.
	// Threshold 0.15 tolerates the curve difference while still catching an
	// inverted/garbage decode (which mismatches at any threshold).
	const { ratio, diffPng } = await pixelDiff(input, art.bytes, { threshold: 0.15 });
	expect(ratio, 'CMYK decode sanity (inversion/garbage guard)').toBeLessThanOrEqual(0.05);
	rec.record({
		id: 'A-06',
		expectation: 'document',
		settings: { tab: 'jpg', output: 'jpg', quality: 80 },
		input: { name: 'photo-cmyk.jpg', bytes: input.length },
		output: { name: art.name, bytes: art.bytes.length },
		metrics: { diffRatio: Number(ratio.toFixed(5)) },
		note: 'CMYK→sRGB has no explicit color management — browser-dependent.',
		assets: {
			original: rec.saveAsset('A-06', 'original', 'photo-cmyk.jpg', fx('photo-cmyk.jpg')),
			output: rec.saveAsset('A-06', 'output', art.name, art.bytes),
			diff: rec.saveAsset('A-06', 'diff', 'diff.png', diffPng)
		}
	});
});

test('A-07: 16-bit PNG survives (documented 8-bit downcast)', async ({ page, rec }) => {
	const input = readFileSync(fx('png-16bit.png'));
	await gotoTab(page, 'png');
	await upload(page, fx('png-16bit.png'));
	await setOutputFormat(page, 'PNG'); // pinned: the tab default became Auto
	await setQuality(page, 100);
	await compress(page);
	const art = await downloadRow(page);
	const m = await imageMeta(art.bytes);
	expect(m.format).toBe('png');
	expect([m.width, m.height]).toEqual([600, 400]);
	const { ratio } = await pixelDiff(input, art.bytes);
	expect(ratio, '16→8 bit rounding only').toBeLessThanOrEqual(0.01);
	rec.record({
		id: 'A-07',
		expectation: 'document',
		settings: { tab: 'png', output: 'png', quality: 100 },
		input: { name: 'png-16bit.png', bytes: input.length, depth: 'ushort' },
		output: { name: art.name, bytes: art.bytes.length, depth: m.depth },
		metrics: { diffRatio: Number(ratio.toFixed(5)) },
		note: `16-bit input is decoded to 8-bit (canvas pipeline) — output depth: ${m.depth}.`,
		assets: {
			original: rec.saveAsset('A-07', 'original', 'png-16bit.png', fx('png-16bit.png')),
			output: rec.saveAsset('A-07', 'output', art.name, art.bytes)
		}
	});
});

test('A-08: interlaced PNG and progressive JPEG decode fine', async ({ page, rec }) => {
	// Interlaced PNG through lossless path.
	await gotoTab(page, 'png');
	await upload(page, fx('png-interlaced.png'));
	await setOutputFormat(page, 'PNG'); // pinned: the tab default became Auto
	await setQuality(page, 100);
	await compress(page);
	const pngArt = await downloadRow(page);
	const pngMeta = await imageMeta(pngArt.bytes);
	expect(pngMeta.format).toBe('png');
	expect([pngMeta.width, pngMeta.height]).toEqual([600, 400]);
	expect(pngArt.bytes.length).toBeLessThanOrEqual(readFileSync(fx('png-interlaced.png')).length);

	// Progressive JPEG through default path.
	await gotoTab(page, 'jpg');
	await upload(page, fx('photo-progressive.jpg'));
	await setOutputFormat(page, 'JPG'); // pinned: the tab default became Auto
	await compress(page);
	const jpgArt = await downloadRow(page);
	const jpgMeta = await imageMeta(jpgArt.bytes);
	expect(jpgMeta.format).toBe('jpeg');
	expect([jpgMeta.width, jpgMeta.height]).toEqual([1200, 800]);
	expect(jpgArt.bytes.length).toBeLessThanOrEqual(readFileSync(fx('photo-progressive.jpg')).length);

	rec.record({
		id: 'A-08',
		settings: { interlacedPng: 'q100', progressiveJpg: 'q80' },
		input: { name: 'png-interlaced.png + photo-progressive.jpg', bytes: 0 },
		output: {
			name: `${pngArt.name} + ${jpgArt.name}`,
			bytes: pngArt.bytes.length + jpgArt.bytes.length
		},
		assets: {
			original: rec.saveAsset('A-08', 'original', 'png-interlaced.png', fx('png-interlaced.png')),
			output: rec.saveAsset('A-08', 'output', pngArt.name, pngArt.bytes)
		}
	});
});

test('A-09: transparent PNG → GIF keeps 1-bit alpha', async ({ page, rec }) => {
	const meta = fxMeta<AlphaMeta>('graphic-alpha.png');
	await gotoTab(page, 'png');
	await upload(page, fx('graphic-alpha.png'));
	await setOutputFormat(page, 'GIF');
	await compress(page);
	const art = await downloadRow(page);
	const m = await imageMeta(art.bytes);
	expect(m.format).toBe('gif');
	const raw = await decodeRaw(art.bytes);
	for (const [x, y] of meta.transparentPoints) {
		expect(pixelAt(raw, x, y)[3], `alpha at ${x},${y} survives as GIF transparency`).toBe(0);
	}
	const [, , , opaqueAlpha] = pixelAt(raw, ...meta.opaquePoint);
	expect(opaqueAlpha, 'opaque content stays opaque').toBe(255);
	rec.record({
		id: 'A-09',
		settings: { tab: 'png', output: 'gif', quality: 80 },
		input: { name: 'graphic-alpha.png', bytes: readFileSync(fx('graphic-alpha.png')).length },
		output: { name: art.name, bytes: art.bytes.length },
		note: 'gifenc rgba4444 quantize + transparentIndex — GIF supports 1-bit alpha.',
		assets: {
			original: rec.saveAsset('A-09', 'original', 'graphic-alpha.png', fx('graphic-alpha.png')),
			output: rec.saveAsset('A-09', 'output', art.name, art.bytes)
		}
	});
});

test('A-10: wide-gamut source gets an honest "converted to sRGB" note', async ({ page, rec }) => {
	await gotoTab(page, 'jpg');
	await upload(page, fx('exif-icc.jpg'), fx('photo-1200x800.jpg'));
	await setOutputFormat(page, 'JPG');
	await compress(page);

	// The P3-tagged source discloses the conversion…
	const iccRow = rowByName(page, 'exif-icc');
	await expect(iccRow.getByTestId('row-info')).toHaveText(/wide-gamut.+converted to sRGB/i);
	// …while the untagged source stays silent.
	await expect(rowByName(page, 'photo-1200x800').getByTestId('row-info')).toHaveCount(0);

	rec.record({
		id: 'A-10',
		settings: { tab: 'jpg', output: 'jpg', quality: 80 },
		input: { name: 'exif-icc.jpg (Display P3)', bytes: readFileSync(fx('exif-icc.jpg')).length },
		note: 'Stage-1 ICC honesty: detection + info line only, no color conversion yet.',
		metrics: {}
	});
});

test('A-11: BMP source counts as lossless — webp q100 is pixel-identical', async ({ page }) => {
	const meta = fxMeta<{ ref: string }>('graphic.bmp');
	await gotoTab(page, 'jpg'); // bmp rides the jpg tab
	await upload(page, fx('graphic.bmp'));
	await setOutputFormat(page, 'WebP');
	await setQuality(page, 100);
	await compress(page);
	const art = await downloadRow(page);
	expect((await imageMeta(art.bytes)).format).toBe('webp');
	// The PNG twin carries the same pixels the BMP does, by construction.
	expect(
		await isPixelIdentical(readFileSync(fx(meta.ref)), art.bytes),
		'BMP → webp q100 must be lossless (VP8L)'
	).toBe(true);
});
