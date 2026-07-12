/**
 * X-01…10: the /remove-exif tab — lossless metadata strip (byte surgery, no
 * re-encode). Pixels must stay byte-identical, orientation must survive via
 * the minimal re-embedded EXIF, ICC stays unless the toggle says otherwise.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { REAL, expect, fx, fxMeta, test } from '../fixtures';
import {
	compress,
	downloadRow,
	downloadRowAt,
	dropFiles,
	gotoTab,
	rows,
	toggle,
	upload
} from '../helpers';
import { exifMeta, imageMeta, isPixelIdentical, jpegSosOffset } from '../verify';

const ICC_TOGGLE = 'Also remove color profile';

/** Chunk types of a PNG, in order (test-local walker — independent of the app). */
function pngChunkTypes(buf: Buffer): { type: string; length: number }[] {
	const chunks: { type: string; length: number }[] = [];
	let i = 8;
	while (i + 8 <= buf.length) {
		const length = buf.readUInt32BE(i);
		const type = buf.toString('latin1', i + 4, i + 8);
		chunks.push({ type, length });
		i += 12 + length;
		if (type === 'IEND') break;
	}
	return chunks;
}

/** Chunk FourCCs of a WebP RIFF container, in order. */
function webpChunkTypes(buf: Buffer): { type: string; length: number }[] {
	const chunks: { type: string; length: number }[] = [];
	let i = 12;
	while (i + 8 <= buf.length) {
		const type = buf.toString('latin1', i, i + 4);
		const length = buf.readUInt32LE(i + 4);
		chunks.push({ type, length });
		i += 8 + length + (length % 2);
	}
	return chunks;
}

test('X-01: strips GPS, camera and date from a JPEG and says so @smoke', async ({ page, rec }) => {
	const input = readFileSync(fx('exif-gps.jpg'));
	await gotoTab(page, 'exif');
	await upload(page, fx('exif-gps.jpg'));
	await compress(page);

	// The row must disclose what was found — the privacy "aha".
	const info = page.getByTestId('row-info');
	await expect(info).toHaveText(/GPS location \(46\.0511°N, 14\.5051°E\)/);
	await expect(info).toHaveText(/Apple iPhone 15 Pro/);
	await expect(info).toHaveText(/taken 2026-05-14/);
	await expect(info).toHaveText(/XMP/);
	await expect(info).toHaveText(/1 comment/);

	const art = await downloadRow(page);
	const m = await exifMeta(art.bytes);
	expect(m.exif, 'EXIF gone').toBeNull();
	expect(m.orientation, 'orientation was 1 — nothing to re-embed').toBeNull();
	expect(art.bytes.length, 'metadata removal must shrink the file').toBeLessThan(input.length);
	expect(await isPixelIdentical(input, art.bytes), 'pixels byte-identical (no re-encode)').toBe(
		true
	);
	rec.record({
		id: 'X-01',
		settings: { tab: 'exif', removeIcc: false },
		input: { name: 'exif-gps.jpg', bytes: input.length },
		output: { name: art.name, bytes: art.bytes.length },
		metrics: { pixelIdentical: true, infoText: (await info.textContent())?.trim() ?? '' },
		assets: {
			original: rec.saveAsset('X-01', 'original', 'exif-gps.jpg', fx('exif-gps.jpg')),
			output: rec.saveAsset('X-01', 'output', art.name, art.bytes)
		}
	});
});

test('X-02: EXIF orientation 6 survives as a minimal re-embedded tag', async ({ page, rec }) => {
	const input = readFileSync(fx('photo-exif6.jpg'));
	const inMeta = await exifMeta(input);
	expect(inMeta.orientation, 'fixture sanity').toBe(6);

	await gotoTab(page, 'exif');
	await upload(page, fx('photo-exif6.jpg'));
	await compress(page);
	await expect(page.getByTestId('row-info')).toHaveText(/Removed:/);

	const art = await downloadRow(page);
	const m = await exifMeta(art.bytes);
	expect(m.orientation, 'photo must not turn sideways').toBe(6);
	expect(m.exif, 'a minimal EXIF replaces the full one').not.toBeNull();
	expect(m.exif!.length, 'orientation-only EXIF stays tiny').toBeLessThanOrEqual(64);
	expect(art.bytes.length).toBeLessThan(input.length);
	expect(await isPixelIdentical(input, art.bytes), 'stored pixels untouched').toBe(true);
	rec.record({
		id: 'X-02',
		settings: { tab: 'exif', removeIcc: false },
		input: { name: 'photo-exif6.jpg', bytes: input.length, exifBytes: inMeta.exif?.length ?? 0 },
		output: { name: art.name, bytes: art.bytes.length, exifBytes: m.exif?.length ?? 0 },
		metrics: { orientationPreserved: true, pixelIdentical: true },
		assets: {
			original: rec.saveAsset('X-02', 'original', 'photo-exif6.jpg', fx('photo-exif6.jpg')),
			output: rec.saveAsset('X-02', 'output', art.name, art.bytes)
		}
	});
});

test('X-03: PNG text chunks and eXIf go away, orientation is re-embedded', async ({
	page,
	rec
}) => {
	const meta = fxMeta<{ orientation: number }>('text-exif.png');
	const input = readFileSync(fx('text-exif.png'));
	await gotoTab(page, 'exif');
	await upload(page, fx('text-exif.png'));
	await compress(page);

	const info = page.getByTestId('row-info');
	await expect(info).toHaveText(/Canon/);
	await expect(info).toHaveText(/text chunk/);

	const art = await downloadRow(page);
	const types = pngChunkTypes(art.bytes).map((c) => c.type);
	for (const dropped of ['tEXt', 'zTXt', 'iTXt', 'tIME']) {
		expect(types, `${dropped} must be gone`).not.toContain(dropped);
	}
	expect(
		types.filter((t) => t === 'eXIf'),
		'exactly one minimal eXIf carries the orientation'
	).toHaveLength(1);
	const m = await exifMeta(art.bytes);
	expect(m.orientation).toBe(meta.orientation);
	expect(art.bytes.length).toBeLessThan(input.length);
	expect(await isPixelIdentical(input, art.bytes)).toBe(true);
	rec.record({
		id: 'X-03',
		settings: { tab: 'exif', removeIcc: false },
		input: { name: 'text-exif.png', bytes: input.length },
		output: { name: art.name, bytes: art.bytes.length, chunks: types.join(' ') },
		metrics: { orientationPreserved: true, pixelIdentical: true },
		assets: {
			original: rec.saveAsset('X-03', 'original', 'text-exif.png', fx('text-exif.png')),
			output: rec.saveAsset('X-03', 'output', art.name, art.bytes)
		}
	});
});

test('X-04: WebP EXIF chunk is replaced and VP8X flags stay honest', async ({ page, rec }) => {
	const input = readFileSync(fx('exif.webp'));
	await gotoTab(page, 'exif');
	await upload(page, fx('exif.webp'));
	await compress(page);

	const art = await downloadRow(page);
	const chunks = webpChunkTypes(art.bytes);
	const exifChunks = chunks.filter((c) => c.type === 'EXIF');
	expect(exifChunks, 'one minimal EXIF chunk (orientation re-embed)').toHaveLength(1);
	expect(exifChunks[0].length, '26-byte orientation-only TIFF').toBe(26);
	expect(chunks.map((c) => c.type)).not.toContain('XMP ');

	// VP8X payload byte 0 (file offset 20): EXIF 0x08 set, XMP 0x04 / ICC 0x20 clear.
	expect(chunks[0].type, 'VP8X stays first').toBe('VP8X');
	const flags = art.bytes[20];
	expect(flags & 0x08, 'EXIF flag stays for the re-embed').not.toBe(0);
	expect(flags & 0x04, 'XMP flag cleared').toBe(0);
	expect(flags & 0x20, 'ICC flag cleared').toBe(0);
	expect(art.bytes.readUInt32LE(4), 'riffSize matches the rebuilt file').toBe(art.bytes.length - 8);

	const m = await exifMeta(art.bytes);
	expect(m.orientation).toBe(6);
	const im = await imageMeta(art.bytes);
	expect(im.format).toBe('webp');
	expect([im.width, im.height]).toEqual([400, 300]);
	expect(art.bytes.length).toBeLessThan(input.length);
	expect(await isPixelIdentical(input, art.bytes)).toBe(true);
	rec.record({
		id: 'X-04',
		settings: { tab: 'exif', removeIcc: false },
		input: { name: 'exif.webp', bytes: input.length },
		output: { name: art.name, bytes: art.bytes.length, flags: `0x${flags.toString(16)}` },
		metrics: { orientationPreserved: true, pixelIdentical: true },
		assets: {
			original: rec.saveAsset('X-04', 'original', 'exif.webp', fx('exif.webp')),
			output: rec.saveAsset('X-04', 'output', art.name, art.bytes)
		}
	});
});

test('X-05: ICC profile stays by default, the toggle removes it', async ({ page, rec }) => {
	const input = readFileSync(fx('exif-icc.jpg'));
	const inMeta = await exifMeta(input);
	expect(inMeta.icc, 'fixture sanity: has a P3 profile').not.toBeNull();

	// Default: EXIF goes, colors stay.
	await gotoTab(page, 'exif');
	await upload(page, fx('exif-icc.jpg'));
	await compress(page);
	const kept = await downloadRow(page);
	const keptMeta = await exifMeta(kept.bytes);
	expect(keptMeta.exif, 'EXIF gone').toBeNull();
	expect(keptMeta.icc, 'ICC kept by default — colors must not shift').not.toBeNull();
	await expect(page.getByTestId('row-info')).not.toHaveText(/color profile/);

	// Toggle on (fresh run keeps the flows independent).
	await gotoTab(page, 'exif');
	await upload(page, fx('exif-icc.jpg'));
	await toggle(page, ICC_TOGGLE, true);
	await compress(page);
	const stripped = await downloadRow(page);
	const strippedMeta = await exifMeta(stripped.bytes);
	expect(strippedMeta.icc, 'toggle removes the profile').toBeNull();
	await expect(page.getByTestId('row-info')).toHaveText(/color profile/);
	expect(stripped.bytes.length).toBeLessThan(kept.bytes.length);
	// With the profile gone, color-MANAGED decodes legitimately differ (that's
	// what the toggle's warning is about), so compare the entropy-coded scan
	// data directly: byte-equal from SOS onward ⇒ pixels identical.
	expect(
		stripped.bytes
			.subarray(jpegSosOffset(stripped.bytes))
			.equals(input.subarray(jpegSosOffset(input))),
		'scan data untouched (no re-encode)'
	).toBe(true);
	rec.record({
		id: 'X-05',
		settings: { tab: 'exif', toggle: ICC_TOGGLE },
		input: { name: 'exif-icc.jpg', bytes: input.length, iccBytes: inMeta.icc?.length ?? 0 },
		output: {
			name: stripped.name,
			bytes: stripped.bytes.length,
			defaultKeptIcc: keptMeta.icc?.length ?? 0
		},
		metrics: { iccKeptByDefault: true, iccRemovedByToggle: true },
		assets: {
			original: rec.saveAsset('X-05', 'original', 'exif-icc.jpg', fx('exif-icc.jpg')),
			output: rec.saveAsset('X-05', 'output', stripped.name, stripped.bytes)
		}
	});
});

test('X-06: a clean file comes back byte-identical with "No metadata found"', async ({
	page,
	rec
}) => {
	const input = readFileSync(fx('tiny-optimized.jpg'));
	await gotoTab(page, 'exif');
	await upload(page, fx('tiny-optimized.jpg'));
	await compress(page);
	await expect(page.getByTestId('row-info')).toHaveText('No metadata found');
	const art = await downloadRow(page);
	expect(input.equals(art.bytes), 'keep-original guard returns the exact input').toBe(true);
	rec.record({
		id: 'X-06',
		settings: { tab: 'exif' },
		input: { name: 'tiny-optimized.jpg', bytes: input.length },
		output: { name: art.name, bytes: art.bytes.length },
		metrics: { byteIdentical: true },
		assets: {
			original: rec.saveAsset('X-06', 'original', 'tiny-optimized.jpg', fx('tiny-optimized.jpg')),
			output: rec.saveAsset('X-06', 'output', art.name, art.bytes)
		}
	});
});

test('X-07: corrupt input shows the error banner and recovers', async ({ page, rec }) => {
	await gotoTab(page, 'exif');
	await upload(page, fx('corrupt.jpg'));
	const run = await compress(page, { expectError: true });
	expect(run.error).toMatch(/Only JPEG, PNG and WebP/);
	await expect(rows(page).getByRole('button', { name: 'Download' })).toHaveCount(0);
	await expect(page.getByTestId('compress-cta'), 'CTA recovers for a retry').toBeEnabled();
	rec.record({
		id: 'X-07',
		settings: { tab: 'exif' },
		input: { name: 'corrupt.jpg', bytes: 256 },
		error: run.error,
		metrics: {}
	});
});

test('X-08: the color-profile toggle persists across reloads', async ({ page }) => {
	// The controls panel only exists once a file is queued.
	await gotoTab(page, 'exif');
	await upload(page, fx('tiny-optimized.jpg'));
	await expect(page.getByLabel(ICC_TOGGLE)).not.toBeChecked();
	await toggle(page, ICC_TOGGLE, true);
	await gotoTab(page, 'exif'); // fresh navigation → settings rehydrate from storage
	await upload(page, fx('tiny-optimized.jpg'));
	await expect(page.getByLabel(ICC_TOGGLE)).toBeChecked();
});

test('X-09: a jpg dropped on /remove-exif routes to the jpg tab', async ({ page }) => {
	// Deliberate: the exif tab is a destination you choose, never a drop target —
	// window-level drops keep routing by file type (routing.ts untouched).
	await gotoTab(page, 'exif');
	await dropFiles(page, [{ path: fx('photo-exif6.jpg'), mimeType: 'image/jpeg' }]);
	await expect(page).toHaveURL(/\/compress-jpg$/);
	await expect(page.getByTestId('error-banner')).toHaveCount(0);
	await expect(rows(page)).toHaveCount(1);
});

test('X-10: real photos strip cleanly (opportunistic)', async ({ page, rec }) => {
	const jpgs = readdirSync(REAL)
		.filter((f) => /\.(jpg|jpeg|jpe)$/i.test(f))
		.slice(0, 3);
	test.skip(jpgs.length === 0, 'drop .jpg photos into tests/fixtures/real/ to enable');

	await gotoTab(page, 'exif');
	await upload(page, ...jpgs.map((f) => join(REAL, f)));
	await compress(page, { timeout: 120_000 });

	for (let i = 0; i < jpgs.length; i++) {
		const input = readFileSync(join(REAL, jpgs[i]));
		const inMeta = await exifMeta(input);
		// By index, not name — real sets contain prefix-colliding names
		// (x.jpe vs x.jpeg) that a hasText row filter cannot disambiguate.
		const art = await downloadRowAt(page, i);
		const m = await exifMeta(art.bytes);
		expect(art.bytes.length, `${jpgs[i]}: never grows`).toBeLessThanOrEqual(input.length);
		expect(await isPixelIdentical(input, art.bytes), `${jpgs[i]}: pixels identical`).toBe(true);
		if (inMeta.orientation && inMeta.orientation !== 1) {
			expect(m.orientation, `${jpgs[i]}: orientation preserved`).toBe(inMeta.orientation);
		} else {
			expect(m.exif, `${jpgs[i]}: no EXIF left`).toBeNull();
		}
		rec.record({
			id: `X-10-${i + 1}`,
			settings: { tab: 'exif', removeIcc: false },
			input: { name: jpgs[i], bytes: input.length, exifBytes: inMeta.exif?.length ?? 0 },
			output: { name: art.name, bytes: art.bytes.length, exifBytes: m.exif?.length ?? 0 },
			metrics: { pixelIdentical: true },
			assets: {
				original: rec.saveAsset(`X-10-${i + 1}`, 'original', jpgs[i], join(REAL, jpgs[i])),
				output: rec.saveAsset(`X-10-${i + 1}`, 'output', art.name, art.bytes)
			}
		});
	}
	// Every row must disclose its findings, even "No metadata found".
	await expect(page.getByTestId('row-info')).toHaveCount(jpgs.length);
});
