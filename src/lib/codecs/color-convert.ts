/**
 * Wide-gamut → sRGB pixel conversion for the WASM-decoded paths. libheif
 * (HEIC) and utif2 (TIFF) hand back raw RGBA in the source gamut and drop
 * the profile, so Display P3 / Adobe RGB values would be reinterpreted as
 * sRGB — visibly desaturated. Browser decoding (createImageBitmap) already
 * color-manages into the sRGB canvas and must never pass through here.
 *
 * Approach: 8-bit → linear via a 256-entry per-curve LUT, one 3×3 matrix in
 * linear light (Bradford-adapted to D65 where the space is D50-referenced),
 * back to 8-bit via a 4096-entry sRGB-encode LUT. Out-of-gamut values clip
 * per channel — the same rendering browsers apply. Alpha is untouched.
 */

import type { WideGamutSpace } from './color-profile';

/** Spaces with known primaries + transfer we can safely matrix-convert.
 *  DCI-P3 (theatrical: gamma 2.6, D63 white) and unrecognized "wide"
 *  profiles are excluded — a wrong transform beats honest passthrough
 *  nowhere. */
export type ConvertibleSpace = 'display-p3' | 'adobe-rgb' | 'prophoto' | 'rec2020';

/** nclx transfer_characteristics we can decode: 709/601/sRGB/2020 SDR
 *  curves. 2 = unspecified (fall back to the space default). PQ (16) and
 *  HLG (18) are HDR — tone mapping is out of scope, skip conversion. */
const SDR_TRANSFERS = new Set([1, 2, 6, 13, 14, 15]);

/**
 * The single conversion gate, shared by the worker (does the conversion)
 * and the main thread (decides whether the "converted to sRGB" note is
 * true). Returns the space to convert with, or null for "leave pixels be".
 */
export function convertibleSpace(
	space: WideGamutSpace,
	transfer?: number
): ConvertibleSpace | null {
	if (space === 'dci-p3' || space === 'wide-other') return null;
	if (transfer !== undefined && !SDR_TRANSFERS.has(transfer)) return null;
	return space;
}

// ------------------------------------------------------------------ matrices
// Linear RGB → XYZ (D65 unless noted), Bruce Lindbloom's values. Composed at
// module load so each published matrix stays verbatim and greppable.

// prettier-ignore
const XYZ_TO_SRGB = [
	 3.2409699419045226, -1.537383177570094,   -0.4986107602930034,
	-0.9692436362808796,  1.8759675015077202,   0.04155505740717559,
	 0.05563007969699366, -0.20397695888897652, 1.0569715142428786
];

// prettier-ignore
const P3_TO_XYZ = [
	0.48657094864821615, 0.26566769316909306, 0.19821728523436247,
	0.22897456406974878, 0.6917385218365064,  0.079286914093745,
	0,                   0.04511338185890264, 1.043944368900976
];

// prettier-ignore
const ADOBE_TO_XYZ = [
	0.5766690429101305,  0.1855582379065463,  0.1882286462349947,
	0.29734497525053605, 0.6273635662554661,  0.07529145849399788,
	0.02703136138641234, 0.07068885253582723, 0.9913375368376388
];

// prettier-ignore
const REC2020_TO_XYZ = [
	0.6369580483012914, 0.14461690358620832, 0.16888097516417205,
	0.2627002120112671, 0.6779980715188708,  0.05930171646986196,
	0,                  0.028072693049087428, 1.060985057710791
];

// ProPhoto (ROMM) is D50-referenced; adapt to D65 before entering sRGB.
// prettier-ignore
const PROPHOTO_TO_XYZ_D50 = [
	0.7976749, 0.1351917, 0.0313534,
	0.2880402, 0.7118741, 0.0000857,
	0,         0,         0.82521
];

// prettier-ignore
const BRADFORD_D50_TO_D65 = [
	 0.9555766, -0.0230393, 0.0631636,
	-0.0282895,  1.0099416, 0.0210077,
	 0.0122982, -0.020483,  1.3299098
];

function mul3x3(a: number[], b: number[]): number[] {
	const out = new Array<number>(9);
	for (let row = 0; row < 3; row++) {
		for (let col = 0; col < 3; col++) {
			out[row * 3 + col] =
				a[row * 3] * b[col] + a[row * 3 + 1] * b[3 + col] + a[row * 3 + 2] * b[6 + col];
		}
	}
	return out;
}

const MATRICES: Record<ConvertibleSpace, number[]> = {
	'display-p3': mul3x3(XYZ_TO_SRGB, P3_TO_XYZ),
	'adobe-rgb': mul3x3(XYZ_TO_SRGB, ADOBE_TO_XYZ),
	rec2020: mul3x3(XYZ_TO_SRGB, REC2020_TO_XYZ),
	prophoto: mul3x3(XYZ_TO_SRGB, mul3x3(BRADFORD_D50_TO_D65, PROPHOTO_TO_XYZ_D50))
};

// ------------------------------------------------------------------- curves

type Curve = 'srgb' | 'gamma22' | 'prophoto' | 'bt709';

function curveFor(space: ConvertibleSpace, transfer?: number): Curve {
	if (transfer === 13) return 'srgb';
	if (transfer === 1 || transfer === 6 || transfer === 14 || transfer === 15) return 'bt709';
	// undefined or 2 (unspecified) — the space's customary curve.
	switch (space) {
		case 'display-p3':
			return 'srgb';
		case 'adobe-rgb':
			return 'gamma22';
		case 'prophoto':
			return 'prophoto';
		case 'rec2020':
			return 'bt709';
	}
}

function decodeChannel(curve: Curve, v: number): number {
	switch (curve) {
		case 'srgb':
			return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
		case 'gamma22':
			// Adobe RGB (1998) specifies exactly 563/256, not 2.2.
			return v ** (563 / 256);
		case 'prophoto':
			// ROMM: linear below 16·Et (Et = 1/512), power 1.8 above.
			return v < 16 / 512 ? v / 16 : v ** 1.8;
		case 'bt709':
			return v < 0.081 ? v / 4.5 : ((v + 0.099) / 1.099) ** (1 / 0.45);
	}
}

function encodeSrgb(v: number): number {
	return v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055;
}

// LUTs are built lazily and cached — the worker converts at most a handful
// of spaces per session.
const decodeLuts = new Map<Curve, Float32Array>();

function decodeLut(curve: Curve): Float32Array {
	let lut = decodeLuts.get(curve);
	if (!lut) {
		lut = new Float32Array(256);
		for (let i = 0; i < 256; i++) lut[i] = decodeChannel(curve, i / 255);
		decodeLuts.set(curve, lut);
	}
	return lut;
}

/** 4096 steps keep the worst-case error (steep 12.92 toe) under half an
 *  8-bit step: 255·12.92/4096 ≈ 0.8 per entry, ±0.4 after rounding. */
const ENCODE_STEPS = 4095;
let encodeLutCache: Uint8Array | null = null;

function encodeLut(): Uint8Array {
	if (!encodeLutCache) {
		encodeLutCache = new Uint8Array(ENCODE_STEPS + 1);
		for (let i = 0; i <= ENCODE_STEPS; i++) {
			encodeLutCache[i] = Math.round(encodeSrgb(i / ENCODE_STEPS) * 255);
		}
	}
	return encodeLutCache;
}

// ------------------------------------------------------------------- public

/** In-place RGBA conversion to sRGB; ~51 MP runs in well under a second. */
export function convertToSrgbInPlace(
	data: Uint8ClampedArray,
	space: ConvertibleSpace,
	transfer?: number
): void {
	const [m0, m1, m2, m3, m4, m5, m6, m7, m8] = MATRICES[space];
	const dec = decodeLut(curveFor(space, transfer));
	const enc = encodeLut();
	for (let i = 0; i < data.length; i += 4) {
		const r = dec[data[i]];
		const g = dec[data[i + 1]];
		const b = dec[data[i + 2]];
		const sr = m0 * r + m1 * g + m2 * b;
		const sg = m3 * r + m4 * g + m5 * b;
		const sb = m6 * r + m7 * g + m8 * b;
		data[i] = enc[sr <= 0 ? 0 : sr >= 1 ? ENCODE_STEPS : (sr * ENCODE_STEPS + 0.5) | 0];
		data[i + 1] = enc[sg <= 0 ? 0 : sg >= 1 ? ENCODE_STEPS : (sg * ENCODE_STEPS + 0.5) | 0];
		data[i + 2] = enc[sb <= 0 ? 0 : sb >= 1 ? ENCODE_STEPS : (sb * ENCODE_STEPS + 0.5) | 0];
	}
}

/** Exact (LUT-free) single-pixel reference — used by tests to pin the LUT
 *  path's accuracy and by nothing hot. */
export function convertPixelReference(
	rgb: [number, number, number],
	space: ConvertibleSpace,
	transfer?: number
): [number, number, number] {
	const curve = curveFor(space, transfer);
	const m = MATRICES[space];
	const lin = rgb.map((v) => decodeChannel(curve, v / 255));
	const out: number[] = [];
	for (let row = 0; row < 3; row++) {
		const v = m[row * 3] * lin[0] + m[row * 3 + 1] * lin[1] + m[row * 3 + 2] * lin[2];
		out.push(Math.round(encodeSrgb(Math.min(1, Math.max(0, v))) * 255));
	}
	return out as [number, number, number];
}
