import { describe, expect, it } from 'vitest';
import { downscaleRungs, isHeicSequence } from './image';

/** Minimal ISOBMFF header: ftyp box with the given major + compatible brands. */
function ftyp(major: string, ...compatible: string[]): ArrayBuffer {
	const size = 16 + compatible.length * 4;
	const b = new Uint8Array(size);
	const view = new DataView(b.buffer);
	view.setUint32(0, size);
	const writeBrand = (off: number, brand: string) => {
		for (let i = 0; i < 4; i++) b[off + i] = brand.charCodeAt(i);
	};
	writeBrand(4, 'ftyp');
	writeBrand(8, major);
	// bytes 12-15 = minor version (zeros)
	compatible.forEach((brand, i) => writeBrand(16 + i * 4, brand));
	return b.buffer;
}

describe('isHeicSequence', () => {
	it('detects sequence major brands (msf1/avis/hevc/hevx)', () => {
		for (const brand of ['msf1', 'avis', 'hevc', 'hevx']) {
			expect(isHeicSequence(ftyp(brand))).toBe(true);
		}
	});

	it('detects a sequence brand hiding in the compatible list', () => {
		expect(isHeicSequence(ftyp('heic', 'mif1', 'msf1'))).toBe(true);
		expect(isHeicSequence(ftyp('mif1', 'heic', 'hevc'))).toBe(true);
	});

	it('leaves plain stills alone (heic/mif1/heix majors, still compatibles)', () => {
		expect(isHeicSequence(ftyp('heic'))).toBe(false);
		expect(isHeicSequence(ftyp('heic', 'mif1', 'miaf'))).toBe(false);
		expect(isHeicSequence(ftyp('mif1', 'heic', 'heix'))).toBe(false);
		expect(isHeicSequence(ftyp('avif', 'mif1'))).toBe(false);
	});

	it('rejects truncated or non-ISOBMFF bytes', () => {
		expect(isHeicSequence(new ArrayBuffer(0))).toBe(false);
		expect(isHeicSequence(new ArrayBuffer(12))).toBe(false);
		expect(isHeicSequence(ftyp('msf1').slice(0, 10))).toBe(false);
		const notFtyp = new Uint8Array(ftyp('msf1'));
		notFtyp[4] = 0x6d; // 'ftyp' → 'mtyp'
		expect(isHeicSequence(notFtyp.buffer)).toBe(false);
	});

	it('stops scanning at the declared box size', () => {
		// msf1 sits BEYOND the declared ftyp box — must not be picked up.
		const bytes = new Uint8Array(ftyp('heic', 'mif1', 'msf1'));
		new DataView(bytes.buffer).setUint32(0, 20); // box ends after 'mif1'
		expect(isHeicSequence(bytes.buffer)).toBe(false);
	});
});

describe('downscaleRungs', () => {
	it('produces strictly shrinking longest-side rungs from the scale ladder', () => {
		const rungs = downscaleRungs(4000);
		expect(rungs).toEqual([
			3600, 3200, 2800, 2400, 2000, 1680, 1400, 1200, 1000, 800, 600, 480, 400, 320
		]);
		for (let i = 1; i < rungs.length; i++) expect(rungs[i]).toBeLessThan(rungs[i - 1]);
	});

	it('floors at 320 px — smaller rungs are dropped, tiny sources get none', () => {
		expect(downscaleRungs(400)).toEqual([360, 320]);
		expect(downscaleRungs(320)).toEqual([]);
		expect(downscaleRungs(100)).toEqual([]);
	});

	it('never returns a rung at or above the source size', () => {
		for (const longest of [321, 356, 500, 1200, 12_000]) {
			for (const rung of downscaleRungs(longest)) {
				expect(rung).toBeLessThan(longest);
				expect(rung).toBeGreaterThanOrEqual(320);
			}
		}
	});

	it('deduplicates rungs that round to the same pixel size', () => {
		for (const longest of [400, 450, 800, 3000]) {
			const rungs = downscaleRungs(longest);
			expect(new Set(rungs).size).toBe(rungs.length);
		}
	});
});
