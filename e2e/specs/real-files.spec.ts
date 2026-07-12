/**
 * RF-01…07: Nik's real-world samples from tests/fixtures/real/ — each test
 * self-skips when its file is absent, so the spec adapts to whatever is
 * dropped in. Assertions stay structural (real content varies); audio adds a
 * browser-decoded non-silence floor; every case lands in the visual report
 * with playable before/after media.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import type { Page } from '@playwright/test';
import {
	REAL,
	assertDiffBudget,
	assertFloor,
	expect,
	realFile,
	test,
	type CaseRecorder
} from '../fixtures';
import {
	audioMetricsInPage,
	compress,
	downloadRow,
	downloadRowAt,
	gotoTab,
	rows,
	setMaxDimension,
	setOutputFormat,
	setQuality,
	setTargetMb,
	upload
} from '../helpers';
import { DIFF_BUDGET, PSNR_FLOOR, REAL_PHOTO } from '../thresholds';
import {
	audioInfo,
	decodeRaw,
	imageMeta,
	pdfInfo,
	qualityMetrics,
	uniqueColorCount,
	videoInfo
} from '../verify';

test.describe.configure({ timeout: 240_000 });

const PDF = join(REAL, 'file-example_PDF_1MB.pdf');
const MOV = join(REAL, 'file_example_MOV_1280_1_4MB.mov');
const MP4 = join(REAL, 'file_example_MP4_1920_18MG.mp4');
const WEBM = join(REAL, 'file_example_WEBM_1920_3_7MB.webm');

test('RF-01: real 42-page PDF through medium level', async ({ page, rec }) => {
	test.skip(!existsSync(PDF), 'file-example_PDF_1MB.pdf not present');
	const input = readFileSync(PDF);
	const inputPages = (await pdfInfo(input)).pageCount;

	await gotoTab(page, 'pdf');
	await upload(page, PDF);
	const run = await compress(page, { timeout: 180_000 });
	const art = await downloadRow(page);
	const info = await pdfInfo(art.bytes);
	expect(info.pageCount, 'every page survives').toBe(inputPages);
	expect(art.bytes.length, 'medium level must not grow a real PDF').toBeLessThanOrEqual(
		input.length
	);
	rec.record({
		id: 'RF-01',
		settings: { tab: 'pdf', op: 'compress', level: 'medium', realWorld: true },
		input: { name: 'file-example_PDF_1MB.pdf', bytes: input.length, pages: inputPages },
		output: { name: art.name, bytes: art.bytes.length, pages: info.pageCount },
		warnings: run.warnings,
		metrics: {
			savingsPct: Number((((input.length - art.bytes.length) / input.length) * 100).toFixed(1))
		},
		assets: { output: rec.saveAsset('RF-01', 'output', art.name, art.bytes) }
	});
});

test('RF-02: real QuickTime MOV converts to MP4', async ({ page, rec }) => {
	test.skip(!existsSync(MOV), 'file_example_MOV_1280_1_4MB.mov not present');
	const input = readFileSync(MOV);
	const inputInfo = await videoInfo(input);

	await gotoTab(page, 'video');
	await upload(page, MOV);
	await setQuality(page, 75);
	const run = await compress(page, { timeout: 180_000 });
	const art = await downloadRow(page);
	expect(art.name.endsWith('.mp4'), `name: ${art.name}`).toBe(true);
	const info = await videoInfo(art.bytes);
	expect(info.videoCodec).toBe('avc');
	expect(
		Math.abs(info.durationSec - inputInfo.durationSec),
		'duration preserved'
	).toBeLessThanOrEqual(0.3);
	rec.record({
		id: 'RF-02',
		settings: { tab: 'video', container: 'mp4', quality: 75, realWorld: true },
		input: {
			name: 'file_example_MOV_1280_1_4MB.mov',
			bytes: input.length,
			width: inputInfo.width,
			height: inputInfo.height
		},
		output: { name: art.name, bytes: art.bytes.length, width: info.width, height: info.height },
		warnings: run.warnings,
		metrics: {
			savingsPct: Number((((input.length - art.bytes.length) / input.length) * 100).toFixed(1)),
			durationSec: Number(info.durationSec.toFixed(2)),
			audio: info.audioCodec ?? 'none'
		},
		assets: {
			original: rec.saveAsset('RF-02', 'original', 'file_example_MOV_1280_1_4MB.mov', MOV),
			output: rec.saveAsset('RF-02', 'output', art.name, art.bytes)
		}
	});
});

test('RF-03: real 17.8 MB MP4 hits an 8 MB target', async ({ page, rec }) => {
	test.skip(!existsSync(MP4), 'file_example_MP4_1920_18MG.mp4 not present');
	const input = readFileSync(MP4);
	const inputInfo = await videoInfo(input);

	await gotoTab(page, 'video');
	await upload(page, MP4);
	await setTargetMb(page, 8);
	const run = await compress(page, { timeout: 220_000 });
	const art = await downloadRow(page);
	const info = await videoInfo(art.bytes);
	expect(art.bytes.length, 'fits under 8 MB (one corrective pass allowed)').toBeLessThanOrEqual(
		8_000_000
	);
	expect(info.videoCodec).toBe('avc');
	expect(
		Math.abs(info.durationSec - inputInfo.durationSec),
		'duration preserved'
	).toBeLessThanOrEqual(0.3);
	rec.record({
		id: 'RF-03',
		settings: { tab: 'video', container: 'mp4', mode: 'target', targetMb: 8, realWorld: true },
		input: {
			name: 'file_example_MP4_1920_18MG.mp4',
			bytes: input.length,
			width: inputInfo.width,
			height: inputInfo.height
		},
		output: { name: art.name, bytes: art.bytes.length },
		warnings: run.warnings,
		metrics: {
			targetBytes: 8_000_000,
			savingsPct: Number((((input.length - art.bytes.length) / input.length) * 100).toFixed(1)),
			durationSec: Number(info.durationSec.toFixed(2)),
			audio: info.audioCodec ?? 'none'
		},
		assets: {
			original: rec.saveAsset('RF-03', 'original', 'file_example_MP4_1920_18MG.mp4', MP4),
			output: rec.saveAsset('RF-03', 'output', art.name, art.bytes)
		}
	});
});

test('RF-04: real WebM converts to MP4', async ({ page, rec }) => {
	test.skip(!existsSync(WEBM), 'file_example_WEBM_1920_3_7MB.webm not present');
	const input = readFileSync(WEBM);
	const inputInfo = await videoInfo(input);

	await gotoTab(page, 'video');
	await upload(page, WEBM);
	await setQuality(page, 75);
	const run = await compress(page, { timeout: 180_000 });
	const art = await downloadRow(page);
	expect(art.name.endsWith('.mp4'), `name: ${art.name}`).toBe(true);
	const info = await videoInfo(art.bytes);
	expect(info.videoCodec).toBe('avc');
	expect(
		Math.abs(info.durationSec - inputInfo.durationSec),
		'duration preserved'
	).toBeLessThanOrEqual(0.3);
	rec.record({
		id: 'RF-04',
		settings: { tab: 'video', container: 'mp4', quality: 75, realWorld: true },
		input: {
			name: 'file_example_WEBM_1920_3_7MB.webm',
			bytes: input.length,
			width: inputInfo.width,
			height: inputInfo.height
		},
		output: { name: art.name, bytes: art.bytes.length, width: info.width, height: info.height },
		warnings: run.warnings,
		metrics: {
			savingsPct: Number((((input.length - art.bytes.length) / input.length) * 100).toFixed(1)),
			durationSec: Number(info.durationSec.toFixed(2)),
			audio: info.audioCodec ?? 'none'
		},
		assets: {
			original: rec.saveAsset('RF-04', 'original', 'file_example_WEBM_1920_3_7MB.webm', WEBM),
			output: rec.saveAsset('RF-04', 'output', art.name, art.bytes)
		}
	});
});

/** Shared body for the real-audio conversions: structural + non-silence. */
async function realAudioCase(
	page: Page,
	rec: CaseRecorder,
	opts: { id: string; src: string; pill: string | null; outMime: string }
) {
	const srcName = basename(opts.src);
	const input = readFileSync(opts.src);
	const inputInfo = await audioInfo(input);
	await gotoTab(page, 'audio');
	await upload(page, opts.src);
	if (opts.pill) {
		const btn = page.getByRole('button', { name: opts.pill, exact: true });
		await btn.click();
		await expect(btn).toHaveAttribute('aria-pressed', 'true');
	}
	const run = await compress(page, { timeout: 180_000 });
	const art = await downloadRow(page);
	const info = await audioInfo(art.bytes);
	expect(
		Math.abs(info.durationSec - inputInfo.durationSec),
		'duration preserved'
	).toBeLessThanOrEqual(0.3);
	expect(info.numberOfChannels, 'channel count preserved').toBe(inputInfo.numberOfChannels);
	// Browser-decoded PCM: real content varies, so only prove it isn't silence.
	const m = await audioMetricsInPage(page, art.bytes, opts.outMime, { probeHz: [440] });
	expect(
		Math.max(...m.channels.map((c) => c.rms)),
		'output must not be silence'
	).toBeGreaterThanOrEqual(0.02);
	rec.record({
		id: opts.id,
		settings: { tab: 'audio', realWorld: true },
		input: { name: srcName, bytes: input.length, codec: inputInfo.audioCodec ?? 'unknown' },
		output: { name: art.name, bytes: art.bytes.length, codec: info.audioCodec ?? 'unknown' },
		warnings: run.warnings,
		metrics: {
			durationSec: Number(info.durationSec.toFixed(2)),
			rms: Number(Math.max(...m.channels.map((c) => c.rms)).toFixed(3)),
			savingsPct: Number((((input.length - art.bytes.length) / input.length) * 100).toFixed(1))
		},
		assets: {
			original: rec.saveAsset(opts.id, 'original', srcName, opts.src),
			output: rec.saveAsset(opts.id, 'output', art.name, art.bytes)
		}
	});
	return { info, outBytes: art.bytes };
}

test('RF-05: real mp3 (ID3 tags) converts to m4a', async ({ page, rec }) => {
	const src = realFile(/\.mp3$/i);
	test.skip(!src, 'drop a real .mp3 into tests/fixtures/real to enable');
	const { info } = await realAudioCase(page, rec, {
		id: 'RF-05',
		src: src!,
		pill: 'M4A',
		outMime: 'audio/mp4'
	});
	expect(info.audioCodec).toBe('aac');
});

test('RF-06: real m4a (AAC) converts to mp3', async ({ page, rec }) => {
	const src = realFile(/\.m4a$/i);
	test.skip(!src, 'drop a real .m4a into tests/fixtures/real to enable');
	const { info } = await realAudioCase(page, rec, {
		id: 'RF-06',
		src: src!,
		pill: null, // mp3 is the default output
		outMime: 'audio/mpeg'
	});
	expect(info.audioCodec).toBe('mp3');
});

test('RF-07: real flac converts to mp3 (decode-only path)', async ({ page, rec }) => {
	const src = realFile(/\.flac$/i);
	test.skip(!src, 'drop a real .flac into tests/fixtures/real to enable');
	const { info } = await realAudioCase(page, rec, {
		id: 'RF-07',
		src: src!,
		pill: null,
		outMime: 'audio/mpeg'
	});
	expect(info.audioCodec).toBe('mp3');
});

test('RF-08: real WAV converts to mp3 (~7× smaller)', async ({ page, rec }) => {
	const src = realFile(/\.wav$/i);
	test.skip(!src, 'drop a real .wav into tests/fixtures/real to enable');
	const input = readFileSync(src!);
	const { info, outBytes } = await realAudioCase(page, rec, {
		id: 'RF-08',
		src: src!,
		pill: null,
		outMime: 'audio/mpeg'
	});
	expect(info.audioCodec).toBe('mp3');
	expect(outBytes.length, 'PCM → 192 kbps must shrink decisively').toBeLessThan(input.length / 5);
});

test('RF-09: real GIF recompresses via gifsicle (dims/frames kept)', async ({ page, rec }) => {
	const src = realFile(/\.gif$/i);
	test.skip(!src, 'drop a real .gif into tests/fixtures/real to enable');
	const input = readFileSync(src!);
	const srcMeta = await imageMeta(input);

	await gotoTab(page, 'gif');
	await upload(page, src!);
	await compress(page, { timeout: 180_000 });
	const art = await downloadRow(page);
	const m = await imageMeta(art.bytes);
	expect(m.format).toBe('gif');
	expect([m.width, m.height]).toEqual([srcMeta.width, srcMeta.height]);
	expect(m.pages, 'frame count preserved').toBe(srcMeta.pages);
	// keep-original guards the ≤; a well-optimized real GIF may not shrink.
	expect(art.bytes.length).toBeLessThanOrEqual(input.length);
	expect(await uniqueColorCount(art.bytes)).toBeLessThanOrEqual(256);
	const { ratio, psnr, diffPng } = await qualityMetrics(input, art.bytes);
	assertDiffBudget(ratio, DIFF_BUDGET.gifOut, `RF-09 real gif`);
	assertFloor(psnr, PSNR_FLOOR.gifOut, `RF-09 real gif psnr`);
	rec.record({
		id: 'RF-09',
		settings: { tab: 'gif', output: 'gif', quality: 80, realWorld: true },
		input: { name: basename(src!), bytes: input.length, pages: srcMeta.pages },
		output: { name: art.name, bytes: art.bytes.length, pages: m.pages },
		metrics: {
			diffRatio: Number(ratio.toFixed(5)),
			psnr: Number(psnr.toFixed(1)),
			savingsPct: Number((((input.length - art.bytes.length) / input.length) * 100).toFixed(1))
		},
		assets: {
			original: rec.saveAsset('RF-09', 'original', basename(src!), src!),
			output: rec.saveAsset('RF-09', 'output', art.name, art.bytes),
			diff: rec.saveAsset('RF-09', 'diff', 'diff.png', diffPng)
		}
	});
});

test('RF-10: real PNG through Auto picks a smaller format', async ({ page, rec }) => {
	const src = realFile(/\.png$/i);
	test.skip(!src, 'drop a real .png into tests/fixtures/real to enable');
	const input = readFileSync(src!);
	const srcMeta = await imageMeta(input);

	await gotoTab(page, 'png');
	await upload(page, src!); // Auto is the tab default — no pill click
	await compress(page);
	const art = await downloadRow(page);
	const m = await imageMeta(art.bytes);
	expect(['webp', 'avif', 'jpeg', 'png']).toContain(m.format);
	expect([m.width, m.height]).toEqual([srcMeta.width, srcMeta.height]);
	expect(art.bytes.length, 'Auto must not grow (original is a candidate)').toBeLessThanOrEqual(
		input.length
	);
	const { ratio, psnr, ssim } = await qualityMetrics(input, art.bytes, { ssim: true });
	assertFloor(psnr, REAL_PHOTO.psnrFloor, 'RF-10 real png psnr');
	rec.record({
		id: 'RF-10',
		settings: { tab: 'png', output: 'auto', quality: 80, realWorld: true },
		input: { name: basename(src!), bytes: input.length },
		output: { name: art.name, bytes: art.bytes.length, format: m.format },
		metrics: {
			diffRatio: Number(ratio.toFixed(5)),
			psnr: Number(psnr.toFixed(1)),
			ssim: ssim === null ? null : Number(ssim.toFixed(4)),
			savingsPct: Number((((input.length - art.bytes.length) / input.length) * 100).toFixed(1))
		},
		assets: {
			original: rec.saveAsset('RF-10', 'original', basename(src!), src!),
			output: rec.saveAsset('RF-10', 'output', art.name, art.bytes)
		}
	});
});

test('RF-11: real TIFF converts to jpg (utif2 decode)', async ({ page, rec }) => {
	const src = realFile(/\.tiff?$/i);
	test.skip(!src, 'drop a real .tiff into tests/fixtures/real to enable');
	const input = readFileSync(src!);
	const srcMeta = await imageMeta(input); // sharp reads TIFF for verification

	await gotoTab(page, 'jpg');
	await upload(page, src!);
	await setOutputFormat(page, 'JPG'); // pinned: the tab default is Auto
	await compress(page);
	const art = await downloadRow(page);
	const m = await imageMeta(art.bytes);
	expect(m.format).toBe('jpeg');
	expect([m.width, m.height]).toEqual([srcMeta.width, srcMeta.height]);
	const { ratio, psnr, diffPng } = await qualityMetrics(input, art.bytes);
	assertDiffBudget(ratio, REAL_PHOTO.ratio, 'RF-11 real tiff');
	assertFloor(psnr, REAL_PHOTO.psnrFloor, 'RF-11 real tiff psnr');
	rec.record({
		id: 'RF-11',
		settings: { tab: 'jpg', output: 'jpg', quality: 80, realWorld: true },
		input: { name: basename(src!), bytes: input.length },
		output: { name: art.name, bytes: art.bytes.length },
		metrics: {
			diffRatio: Number(ratio.toFixed(5)),
			psnr: Number(psnr.toFixed(1)),
			savingsPct: Number((((input.length - art.bytes.length) / input.length) * 100).toFixed(1))
		},
		assets: {
			original: rec.saveAsset('RF-11', 'original', basename(src!), src!),
			output: rec.saveAsset('RF-11', 'output', art.name, art.bytes),
			diff: rec.saveAsset('RF-11', 'diff', 'diff.png', diffPng)
		}
	});
});

test('RF-12: real 54 MB BMP (18 MP) converts to jpg', async ({ page, rec }) => {
	const src = realFile(/\.bmp$/i);
	test.skip(!src, 'drop a real .bmp into tests/fixtures/real to enable');
	const input = readFileSync(src!);
	// sharp can't decode BMP — read the dimensions straight from the header
	// (BITMAPINFOHEADER: i32 LE width @18, height @22; height may be negative).
	const srcWidth = input.readInt32LE(18);
	const srcHeight = Math.abs(input.readInt32LE(22));

	await gotoTab(page, 'jpg');
	await upload(page, src!);
	await setOutputFormat(page, 'JPG');
	await compress(page, { timeout: 240_000 }); // 54 MB upload + 18 MP encode
	const art = await downloadRow(page);
	const m = await imageMeta(art.bytes);
	expect(m.format).toBe('jpeg');
	expect([m.width, m.height]).toEqual([srcWidth, srcHeight]);
	expect(art.bytes.length, 'raw pixels → q80 jpeg must shrink ≥10×').toBeLessThan(
		input.length / 10
	);
	rec.record({
		id: 'RF-12',
		settings: { tab: 'jpg', output: 'jpg', quality: 80, realWorld: true },
		input: { name: basename(src!), bytes: input.length, width: srcWidth, height: srcHeight },
		output: { name: art.name, bytes: art.bytes.length },
		note: 'Structural only — node-side sharp cannot decode BMP, so no pixel diff.',
		metrics: {
			savingsPct: Number((((input.length - art.bytes.length) / input.length) * 100).toFixed(1))
		},
		assets: { output: rec.saveAsset('RF-12', 'output', art.name, art.bytes) }
	});
});

test('RF-13: real 18 MP JPEG recompresses at q80', async ({ page, rec }) => {
	const src = realFile(/\.jpe?g$/i);
	test.skip(!src, 'drop a real .jpg into tests/fixtures/real to enable');
	const input = readFileSync(src!);
	const srcMeta = await imageMeta(input);

	await gotoTab(page, 'jpg');
	await upload(page, src!);
	await setOutputFormat(page, 'JPG');
	await compress(page, { timeout: 180_000 });
	const art = await downloadRow(page);
	const m = await imageMeta(art.bytes);
	expect(m.format).toBe('jpeg');
	expect([m.width, m.height]).toEqual([srcMeta.width, srcMeta.height]);
	expect(art.bytes.length, 'same-format must not grow').toBeLessThanOrEqual(input.length);
	const { ratio, psnr } = await qualityMetrics(input, art.bytes);
	assertDiffBudget(ratio, REAL_PHOTO.ratio, 'RF-13 real jpeg');
	assertFloor(psnr, REAL_PHOTO.psnrFloor, 'RF-13 real jpeg psnr');
	rec.record({
		id: 'RF-13',
		settings: { tab: 'jpg', output: 'jpg', quality: 80, realWorld: true },
		input: { name: basename(src!), bytes: input.length, width: srcMeta.width },
		output: { name: art.name, bytes: art.bytes.length },
		metrics: {
			diffRatio: Number(ratio.toFixed(5)),
			psnr: Number(psnr.toFixed(1)),
			savingsPct: Number((((input.length - art.bytes.length) / input.length) * 100).toFixed(1))
		},
		assets: { output: rec.saveAsset('RF-13', 'output', art.name, art.bytes) }
	});
});

test('RF-14: real PDFs batch through medium level', async ({ page, rec }) => {
	const pdfs = readdirSync(REAL)
		.filter((f) => /^sample\d+\.pdf$/i.test(f))
		.sort();
	test.skip(pdfs.length === 0, 'drop sample*.pdf files into tests/fixtures/real to enable');

	await gotoTab(page, 'pdf');
	await upload(page, ...pdfs.map((f) => join(REAL, f)));
	await compress(page, { timeout: 240_000 }); // gs runs serially per file
	for (const name of pdfs) {
		const input = readFileSync(join(REAL, name));
		const inInfo = await pdfInfo(input);
		const art = await downloadRow(page, name);
		const outInfo = await pdfInfo(art.bytes);
		expect(outInfo.pageCount, `${name}: every page survives`).toBe(inInfo.pageCount);
		expect(art.bytes.length, `${name}: medium must not grow`).toBeLessThanOrEqual(input.length);
		rec.record({
			id: `RF-14-${name}`,
			settings: { tab: 'pdf', op: 'compress', level: 'medium', realWorld: true },
			input: { name, bytes: input.length, pages: inInfo.pageCount },
			output: { name: art.name, bytes: art.bytes.length, pages: outInfo.pageCount },
			metrics: {
				savingsPct: Number((((input.length - art.bytes.length) / input.length) * 100).toFixed(1))
			},
			assets: { output: rec.saveAsset(`RF-14-${name}`, 'output', art.name, art.bytes) }
		});
	}
});

test('RF-15: real HEIC + HEIF convert to jpg without sequence warnings', async ({ page, rec }) => {
	// 51 MP decode + wasm resize is ~14 s solo but CPU-starved under the full
	// 4-worker suite (concurrent gs jobs) — same generous-timeout treatment as
	// the 12 MP double-ladder test (T-06).
	test.setTimeout(480_000);
	const files = [realFile(/\.heic$/i), realFile(/\.heif$/i)].filter((f): f is string => f !== null);
	test.skip(files.length === 0, 'drop a real .heic/.heif into tests/fixtures/real to enable');

	// The .heif sample is 51 MP (8736×5856) — full-res mozjpeg would run for
	// minutes, so cap the longest side (this also exercises the resize path).
	const MAX_DIMENSION = 4000;
	await gotoTab(page, 'heic');
	await upload(page, ...files);
	await setMaxDimension(page, MAX_DIMENSION);
	await compress(page, { timeout: 360_000 }); // jpg is the heic-tab default
	// Real stills (mif1/heic brands) must NOT trip the isHeicSequence warning.
	await expect(page.getByTestId('row-warning')).toHaveCount(0);
	// A real iPhone capture (IMG_*.HEIC) is Display P3 — the worker converts
	// and the row must say so; untagged samples must stay silent.
	if (/img_\d+\.heic$/i.test(files[0])) {
		await expect(rows(page).nth(0).getByTestId('row-info')).toHaveText(
			/Display P3.*converted to sRGB/
		);
	}

	for (let i = 0; i < files.length; i++) {
		const src = files[i];
		const input = readFileSync(src);
		const srcRaw = await decodeRaw(input); // icodec/libheif node decode
		const scale = Math.min(1, MAX_DIMENSION / Math.max(srcRaw.width, srcRaw.height));
		// By index — result rows show the OUTPUT name (both become sample1.jpg).
		const art = await downloadRowAt(page, i);
		const m = await imageMeta(art.bytes);
		expect(m.format, `${basename(src)} → jpeg`).toBe('jpeg');
		expect([m.width, m.height], `${basename(src)} dimensions`).toEqual([
			Math.round(srcRaw.width * scale),
			Math.round(srcRaw.height * scale)
		]);
		const { ratio, psnr } = await qualityMetrics(input, art.bytes);
		assertDiffBudget(ratio, REAL_PHOTO.ratio, `RF-15 ${basename(src)}`);
		assertFloor(psnr, REAL_PHOTO.psnrFloor, `RF-15 ${basename(src)} psnr`);
		rec.record({
			id: `RF-15-${basename(src)}`,
			settings: { tab: 'heic', output: 'jpg', quality: 80, maxDimension: MAX_DIMENSION },
			input: { name: basename(src), bytes: input.length, width: srcRaw.width },
			output: { name: art.name, bytes: art.bytes.length, width: m.width, height: m.height },
			metrics: { diffRatio: Number(ratio.toFixed(5)), psnr: Number(psnr.toFixed(1)) },
			assets: { output: rec.saveAsset(`RF-15-${basename(src)}`, 'output', art.name, art.bytes) }
		});
	}
});

test('RF-16: 48 MP iPhone HEIC converts through the max-dimension cap', async ({ page, rec }) => {
	// IMG_0884.HEIC (8064×6048, Display P3) never wins realFile's sort while
	// IMG_0883 exists — this test targets it explicitly. Structural-only, RF-12
	// style: a 48 MP node-side reference decode would dominate the runtime.
	test.setTimeout(240_000);
	const src = realFile(/IMG_0884\.heic$/i);
	test.skip(!src, 'drop IMG_0884.HEIC into tests/fixtures/real to enable');
	const input = readFileSync(src!);

	await gotoTab(page, 'heic');
	await upload(page, src!);
	await setMaxDimension(page, 2000);
	await compress(page, { timeout: 200_000 });
	await expect(page.getByTestId('row-warning')).toHaveCount(0);
	await expect(page.getByTestId('row-info')).toHaveText(/Display P3.*converted to sRGB/);
	const art = await downloadRow(page);
	const m = await imageMeta(art.bytes);
	expect(m.format).toBe('jpeg');
	// 8064×6048 is exactly 4:3, but the capture is PORTRAIT via an irot box
	// libheif applies at decode — assert sides, not their order.
	expect(Math.max(m.width, m.height), 'longest side capped').toBe(2000);
	expect(Math.min(m.width, m.height), '4:3 aspect preserved').toBe(1500);
	rec.record({
		id: 'RF-16',
		settings: { tab: 'heic', output: 'jpg', quality: 80, maxDimension: 2000 },
		input: { name: basename(src!), bytes: input.length, width: 8064, height: 6048 },
		output: { name: art.name, bytes: art.bytes.length, width: m.width, height: m.height },
		assets: { output: rec.saveAsset('RF-16', 'output', art.name, art.bytes) }
	});
});
