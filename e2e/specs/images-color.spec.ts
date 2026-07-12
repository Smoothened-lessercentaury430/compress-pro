/**
 * CP-01…03: real wide-gamut → sRGB conversion. The fixtures physically hold
 * Display-P3-space values (`p3` in the manifest — sharp's export transforms
 * on write); their correct sRGB rendering is the authored `srgb`. The TIFF
 * rides the WASM decode path (utif2 is color-blind → the worker's matrix
 * must convert); the pixel-identical PNG rides createImageBitmap, where
 * CHROME converts. Both must land on `srgb` — landing on `p3` means the
 * conversion didn't run, landing elsewhere means double conversion. The
 * spec also pins the src matrices against sharp/lcms's authoring transform
 * (convertPixelReference(p3) ≈ srgb).
 */
import { readFileSync } from 'node:fs';
import { convertPixelReference } from '../../src/lib/codecs/color-convert';
import { expect, fx, fxMeta, test } from '../fixtures';
import { compress, downloadRow, gotoTab, setOutputFormat, upload } from '../helpers';
import { decodeRaw, pixelAt, type RawImage } from '../verify';

type Patch = { at: [number, number]; srgb: [number, number, number]; p3: [number, number, number] };
type PatchMeta = { patches: Patch[] };

/** Mean over a small neighborhood — kills JPEG ringing at patch centers. */
function meanAt(raw: RawImage, cx: number, cy: number): number[] {
	const sums = [0, 0, 0];
	const offsets = [-8, 0, 8];
	for (const dy of offsets) {
		for (const dx of offsets) {
			const [r, g, b] = pixelAt(raw, cx + dx, cy + dy);
			sums[0] += r;
			sums[1] += g;
			sums[2] += b;
		}
	}
	return sums.map((s) => Math.round(s / 9));
}

/** ±10 per channel: engine differences (Chrome lcms vs our LUT) + q80 JPEG noise. */
const TOLERANCE = 10;

function expectPatches(raw: RawImage, meta: PatchMeta, label: string): void {
	for (const { at, srgb, p3 } of meta.patches) {
		// The app's matrices must agree with the lcms transform sharp used at
		// authoring time (independent implementations of the same standard).
		const ref = convertPixelReference(p3, 'display-p3');
		for (let c = 0; c < 3; c++) {
			expect(
				Math.abs(ref[c] - srgb[c]),
				`${label} matrices vs lcms @${at} ch${c}: ref ${ref}, lcms ${srgb}`
			).toBeLessThanOrEqual(3);
		}

		const got = meanAt(raw, at[0], at[1]);
		for (let c = 0; c < 3; c++) {
			expect(
				Math.abs(got[c] - srgb[c]),
				`${label} patch@${at} ch${c}: got ${got}, want ≈${srgb}`
			).toBeLessThanOrEqual(TOLERANCE);
		}
		// The output must have MOVED away from the raw file values — staying
		// on them means the conversion never ran. Only meaningful where the
		// two spaces actually disagree enough to survive JPEG noise.
		const expectedMove = Math.max(...srgb.map((v, c) => Math.abs(v - p3[c])));
		if (expectedMove >= 10) {
			const moved = Math.max(...got.map((v, c) => Math.abs(v - p3[c])));
			expect(
				moved,
				`${label} patch@${at}: output ${got} still equals file values ${p3}`
			).toBeGreaterThanOrEqual(Math.round(expectedMove / 2));
		}
	}
}

test('CP-01: P3 TIFF (wasm decode) converts to sRGB and says so', async ({ page, rec }) => {
	const meta = fxMeta<PatchMeta>('p3-patches.tiff');
	await gotoTab(page, 'jpg');
	await upload(page, fx('p3-patches.tiff'));
	await setOutputFormat(page, 'JPG');
	await compress(page);
	await expect(page.getByTestId('row-info')).toHaveText(/wide-gamut.+converted to sRGB/i);
	const art = await downloadRow(page);
	const raw = await decodeRaw(art.bytes);
	expectPatches(raw, meta, 'CP-01');
	rec.record({
		id: 'CP-01',
		settings: { tab: 'jpg', output: 'jpg', quality: 80 },
		input: { name: 'p3-patches.tiff', bytes: readFileSync(fx('p3-patches.tiff')).length },
		output: { name: art.name, bytes: art.bytes.length },
		assets: {
			original: rec.saveAsset('CP-01', 'original', 'p3-patches.tiff', fx('p3-patches.tiff')),
			output: rec.saveAsset('CP-01', 'output', art.name, art.bytes)
		}
	});
});

test('CP-02: P3 PNG (browser decode) lands on the same sRGB — no double conversion', async ({
	page,
	rec
}) => {
	const meta = fxMeta<PatchMeta>('p3-patches.png');
	await gotoTab(page, 'jpg');
	await upload(page, fx('p3-patches.png'));
	await setOutputFormat(page, 'JPG');
	await compress(page);
	await expect(page.getByTestId('row-info')).toHaveText(/wide-gamut.+converted to sRGB/i);
	const art = await downloadRow(page);
	const raw = await decodeRaw(art.bytes);
	expectPatches(raw, meta, 'CP-02');
	rec.record({
		id: 'CP-02',
		settings: { tab: 'jpg', output: 'jpg', quality: 80 },
		input: { name: 'p3-patches.png', bytes: readFileSync(fx('p3-patches.png')).length },
		output: { name: art.name, bytes: art.bytes.length },
		assets: {
			original: rec.saveAsset('CP-02', 'original', 'p3-patches.png', fx('p3-patches.png')),
			output: rec.saveAsset('CP-02', 'output', art.name, art.bytes)
		}
	});
});

test('CP-03: untagged TIFF converts nothing and stays silent', async ({ page, rec }) => {
	await gotoTab(page, 'jpg');
	await upload(page, fx('photo.tiff'));
	await setOutputFormat(page, 'JPG');
	await compress(page);
	await expect(page.getByTestId('row-info')).toHaveCount(0);
	const art = await downloadRow(page);
	// Values must pass through: compare a center sample against the source.
	const src = await decodeRaw(readFileSync(fx('photo.tiff')));
	const out = await decodeRaw(art.bytes);
	const a = meanAt(src, 400, 300);
	const b = meanAt(out, 400, 300);
	for (let c = 0; c < 3; c++) {
		expect(Math.abs(a[c] - b[c]), `CP-03 center ch${c}`).toBeLessThanOrEqual(TOLERANCE);
	}
	rec.record({
		id: 'CP-03',
		settings: { tab: 'jpg', output: 'jpg', quality: 80 },
		input: { name: 'photo.tiff', bytes: readFileSync(fx('photo.tiff')).length },
		output: { name: art.name, bytes: art.bytes.length },
		assets: {
			original: rec.saveAsset('CP-03', 'original', 'photo.tiff', fx('photo.tiff')),
			output: rec.saveAsset('CP-03', 'output', art.name, art.bytes)
		}
	});
});
