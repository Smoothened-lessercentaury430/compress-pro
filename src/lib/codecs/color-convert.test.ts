import { describe, expect, it } from 'vitest';
import {
	convertibleSpace,
	convertPixelReference,
	convertToSrgbInPlace,
	type ConvertibleSpace
} from './color-convert';

const SPACES: ConvertibleSpace[] = ['display-p3', 'adobe-rgb', 'prophoto', 'rec2020'];

/** Runs the in-place LUT path on a single pixel. */
function convertPixel(
	rgb: [number, number, number],
	space: ConvertibleSpace,
	transfer?: number
): [number, number, number] {
	const data = new Uint8ClampedArray([...rgb, 255]);
	convertToSrgbInPlace(data, space, transfer);
	return [data[0], data[1], data[2]];
}

describe('convertibleSpace', () => {
	it('excludes DCI-P3 and unknown wide profiles', () => {
		expect(convertibleSpace('dci-p3')).toBeNull();
		expect(convertibleSpace('wide-other')).toBeNull();
	});

	it('excludes HDR transfers (PQ/HLG), allows SDR and unspecified', () => {
		expect(convertibleSpace('display-p3', 16)).toBeNull(); // PQ
		expect(convertibleSpace('display-p3', 18)).toBeNull(); // HLG
		expect(convertibleSpace('display-p3', 13)).toBe('display-p3'); // sRGB
		expect(convertibleSpace('display-p3', 2)).toBe('display-p3'); // unspecified
		expect(convertibleSpace('display-p3')).toBe('display-p3'); // ICC path
		expect(convertibleSpace('rec2020', 14)).toBe('rec2020'); // BT.2020 10-bit
		expect(convertibleSpace('adobe-rgb')).toBe('adobe-rgb');
		expect(convertibleSpace('prophoto')).toBe('prophoto');
	});
});

describe('convertToSrgbInPlace', () => {
	it('preserves white and black exactly in every space', () => {
		for (const space of SPACES) {
			expect(convertPixel([255, 255, 255], space)).toEqual([255, 255, 255]);
			expect(convertPixel([0, 0, 0], space)).toEqual([0, 0, 0]);
		}
	});

	it('preserves neutrality (R=G=B stays R=G=B) in every space', () => {
		for (const space of SPACES) {
			for (const v of [10, 64, 128, 200, 240]) {
				const [r, g, b] = convertPixel([v, v, v], space);
				expect(Math.abs(r - g)).toBeLessThanOrEqual(1);
				expect(Math.abs(g - b)).toBeLessThanOrEqual(1);
			}
		}
	});

	it('keeps Display P3 grays value-invariant (same transfer curve)', () => {
		for (const v of [1, 33, 128, 213, 254]) {
			const [r] = convertPixel([v, v, v], 'display-p3');
			expect(Math.abs(r - v)).toBeLessThanOrEqual(1);
		}
	});

	it('clips out-of-gamut P3 primaries to the sRGB primaries', () => {
		expect(convertPixel([255, 0, 0], 'display-p3')).toEqual([255, 0, 0]);
		expect(convertPixel([0, 255, 0], 'display-p3')).toEqual([0, 255, 0]);
	});

	it('renders a P3 red with stronger sRGB red and crushed green', () => {
		// The same physical color needs MORE sRGB red signal (weaker primary)
		// and less green — the naive "reinterpret as sRGB" look this fixes was
		// the duller (200,30,30).
		const [r, g] = convertPixel([200, 30, 30], 'display-p3');
		expect(r).toBeGreaterThan(200);
		expect(g).toBeLessThan(30);
	});

	it('leaves alpha untouched and converts in place', () => {
		const data = new Uint8ClampedArray([200, 30, 30, 77, 128, 128, 128, 0]);
		convertToSrgbInPlace(data, 'display-p3');
		expect(data[3]).toBe(77);
		expect(data[7]).toBe(0);
	});

	it('matches the exact reference implementation within 1/255 everywhere', () => {
		// Coarse RGB lattice ×4 spaces = 4×9³ pixels; LUT error budget is ±1
		// (encode LUT quantization ±0.4 + rounding).
		const steps = [0, 31, 63, 95, 127, 159, 191, 223, 255];
		for (const space of SPACES) {
			for (const r of steps) {
				for (const g of steps) {
					for (const b of steps) {
						const lut = convertPixel([r, g, b], space);
						const ref = convertPixelReference([r, g, b], space);
						for (let c = 0; c < 3; c++) {
							expect(
								Math.abs(lut[c] - ref[c]),
								`${space} rgb(${r},${g},${b}) ch${c}`
							).toBeLessThanOrEqual(1);
						}
					}
				}
			}
		}
	});

	it('honors an sRGB nclx transfer for Rec.2020 sources', () => {
		// transfer 13 (sRGB) vs default BT.709 curve must differ in midtones.
		const srgbCurve = convertPixel([100, 100, 100], 'rec2020', 13);
		const btCurve = convertPixel([100, 100, 100], 'rec2020', 14);
		expect(srgbCurve[0]).not.toBe(btCurve[0]);
		// With the sRGB curve, gray round-trips value-invariantly.
		expect(Math.abs(srgbCurve[0] - 100)).toBeLessThanOrEqual(1);
	});
});
