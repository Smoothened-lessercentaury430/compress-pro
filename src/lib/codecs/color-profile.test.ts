import { deflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import {
	classifyWideGamut,
	detectColorSpace,
	detectWideGamut,
	iccDescription,
	isWasmDecodedSource
} from './color-profile';

// --- test-side builders (deliberately independent of the module) -----------

const bytes = (...parts: (number[] | Uint8Array | string)[]): Uint8Array => {
	const arrays = parts.map((p) =>
		typeof p === 'string' ? new TextEncoder().encode(p) : new Uint8Array(p)
	);
	const out = new Uint8Array(arrays.reduce((s, a) => s + a.length, 0));
	let at = 0;
	for (const a of arrays) {
		out.set(a, at);
		at += a.length;
	}
	return out;
};

const u32 = (n: number) => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
const u16 = (n: number) => [(n >> 8) & 0xff, n & 0xff];

/** Minimal ICC v2 profile: 128-byte header + one `desc` tag (ASCII). */
function iccV2(desc: string): Uint8Array {
	const ascii = desc + '\0';
	const tagData = bytes('desc', u32(0), u32(ascii.length), ascii);
	const tagOffset = 132 + 12; // header + count + one table entry
	const profile = bytes(
		new Uint8Array(128), // header (size field unused by the parser)
		u32(1), // tag count
		'desc',
		u32(tagOffset),
		u32(tagData.length),
		tagData
	);
	return profile;
}

/** Minimal ICC v4 profile: `desc` tag of type `mluc` (UTF-16BE). */
function iccV4(desc: string): Uint8Array {
	const utf16 = new Uint8Array(desc.length * 2);
	for (let i = 0; i < desc.length; i++) {
		utf16[i * 2] = desc.charCodeAt(i) >> 8;
		utf16[i * 2 + 1] = desc.charCodeAt(i) & 0xff;
	}
	// mluc: sig(4) reserved(4) count(4) recordSize(4) [lang(2) country(2) len(4) off(4)] string
	const tagData = bytes(
		'mluc',
		u32(0),
		u32(1),
		u32(12),
		'enUS',
		u32(utf16.length),
		u32(28), // string offset from tag start
		utf16
	);
	const tagOffset = 132 + 12;
	return bytes(new Uint8Array(128), u32(1), 'desc', u32(tagOffset), u32(tagData.length), tagData);
}

const jpegSeg = (marker: number, payload: Uint8Array | number[] | string): Uint8Array => {
	const body = bytes(payload);
	return bytes([0xff, marker, (body.length + 2) >> 8, (body.length + 2) & 0xff], body);
};

/** JPEG carrying `profile` split across two APP2 ICC_PROFILE segments. */
function jpegWithIcc(profile: Uint8Array): Uint8Array {
	const half = Math.ceil(profile.length / 2);
	const part = (seq: number, data: Uint8Array) =>
		jpegSeg(0xe2, bytes('ICC_PROFILE\0', [seq, 2], data));
	return bytes(
		[0xff, 0xd8],
		part(2, profile.subarray(half)), // out of order on purpose — must sort by seq
		part(1, profile.subarray(0, half)),
		[0xff, 0xda, 0x00, 0x04, 0x01, 0x02],
		[0x11, 0x22],
		[0xff, 0xd9]
	);
}

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const pngChunk = (type: string, payload: Uint8Array | number[] | string): Uint8Array => {
	const body = bytes(payload);
	return bytes(u32(body.length), type, body, u32(0)); // CRC unchecked by the parser
};

function pngWithIcc(profile: Uint8Array): Uint8Array {
	const iccp = bytes('p3\0', [0], deflateSync(profile));
	return bytes(
		PNG_SIG,
		pngChunk('IHDR', new Uint8Array(13)),
		pngChunk('iCCP', iccp),
		pngChunk('IDAT', [1, 2, 3]),
		pngChunk('IEND', [])
	);
}

const webpChunk = (type: string, payload: Uint8Array): Uint8Array => {
	const size = payload.length;
	const chunk = bytes(
		type,
		[size & 0xff, (size >> 8) & 0xff, (size >> 16) & 0xff, (size >> 24) & 0xff],
		payload
	);
	return size % 2 ? bytes(chunk, [0]) : chunk;
};

function webpWithIcc(profile: Uint8Array): Uint8Array {
	const body = bytes(
		webpChunk('VP8X', new Uint8Array(10)),
		webpChunk('ICCP', profile),
		webpChunk('VP8 ', new Uint8Array(20))
	);
	return bytes(
		'RIFF',
		[(body.length + 4) & 0xff, ((body.length + 4) >> 8) & 0xff, 0, 0],
		'WEBP',
		body
	);
}

const box = (type: string, ...payload: (Uint8Array | number[] | string)[]): Uint8Array => {
	const body = bytes(...payload);
	return bytes(u32(body.length + 8), type, body);
};

const u16le = (n: number) => [n & 0xff, (n >> 8) & 0xff];
const u32le = (n: number) => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff];

/** Minimal little-endian TIFF whose IFD0 carries tag 34675 (ICC profile). */
function tiffWithIcc(profile: Uint8Array): Uint8Array {
	// header(8) + entry count(2) + one entry(12) + next-IFD(4) = data at 26.
	return bytes(
		'II',
		u16le(42),
		u32le(8), // IFD0 offset
		u16le(1), // one entry
		u16le(0x8773),
		u16le(7), // UNDEFINED
		u32le(profile.length),
		u32le(26),
		u32le(0), // next IFD
		profile
	);
}

/** Minimal HEIC-shaped ISOBMFF: ftyp + meta(FullBox)/iprp/ipco/colr. */
function heicWithColr(colrPayload: Uint8Array): Uint8Array {
	return bytes(
		box('ftyp', 'heic', u32(0), 'heicmif1'),
		box('meta', u32(0), box('iprp', box('ipco', box('colr', colrPayload))))
	);
}

// ---------------------------------------------------------------------------

describe('iccDescription + classifyWideGamut', () => {
	it('reads a v2 desc tag', () => {
		expect(iccDescription(iccV2('Adobe RGB (1998)'))).toBe('Adobe RGB (1998)');
	});

	it('reads a v4 mluc tag (UTF-16BE)', () => {
		expect(iccDescription(iccV4('Display P3'))).toBe('Display P3');
	});

	it('classifies the wide-gamut family and stays silent otherwise', () => {
		expect(classifyWideGamut('Display P3')).toBe('Display P3');
		expect(classifyWideGamut('sP3C')).toBe('Display P3');
		expect(classifyWideGamut('Adobe RGB (1998)')).toBe('Adobe RGB');
		expect(classifyWideGamut('ProPhoto RGB')).toBe('ProPhoto RGB');
		expect(classifyWideGamut('ITU-R BT.2020')).toBe('Rec. 2020');
		expect(classifyWideGamut('sRGB IEC61966-2.1')).toBeNull();
		expect(classifyWideGamut('U.S. Web Coated (SWOP) v2')).toBeNull(); // CMYK must not trigger
	});
});

describe('detectWideGamut', () => {
	const asArrayBuffer = (b: Uint8Array) =>
		b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;

	it('finds a multi-segment APP2 profile in a JPEG (out-of-order parts)', async () => {
		const jpeg = jpegWithIcc(iccV4('Display P3'));
		expect(await detectWideGamut(asArrayBuffer(jpeg))).toBe('Display P3');
	});

	it('inflates and reads a PNG iCCP profile', async () => {
		const png = pngWithIcc(iccV2('Adobe RGB (1998)'));
		expect(await detectWideGamut(asArrayBuffer(png))).toBe('Adobe RGB');
	});

	it('reads a WebP ICCP chunk', async () => {
		const webp = webpWithIcc(iccV4('Display P3'));
		expect(await detectWideGamut(asArrayBuffer(webp))).toBe('Display P3');
	});

	it('reads ISOBMFF colr nclx primaries (12 = Display P3)', async () => {
		const heic = heicWithColr(bytes('nclx', u16(12), u16(16), u16(6), [0x80]));
		expect(await detectWideGamut(asArrayBuffer(heic))).toBe('Display P3');
		const srgb = heicWithColr(bytes('nclx', u16(1), u16(13), u16(6), [0x80]));
		expect(await detectWideGamut(asArrayBuffer(srgb))).toBeNull();
	});

	it('reads ISOBMFF colr prof (embedded ICC)', async () => {
		const heic = heicWithColr(bytes('prof', iccV2('ProPhoto RGB')));
		expect(await detectWideGamut(asArrayBuffer(heic))).toBe('ProPhoto RGB');
	});

	it('reads a TIFF tag-34675 ICC profile', async () => {
		const tiff = tiffWithIcc(iccV2('Adobe RGB (1998)'));
		expect(await detectWideGamut(asArrayBuffer(tiff))).toBe('Adobe RGB');
		// Untagged TIFF stays silent.
		expect(await detectWideGamut(asArrayBuffer(tiffWithIcc(iccV2('sRGB'))))).toBeNull();
	});

	it('returns null for sRGB profiles, untagged files and garbage — never throws', async () => {
		expect(
			await detectWideGamut(asArrayBuffer(jpegWithIcc(iccV2('sRGB IEC61966-2.1'))))
		).toBeNull();
		expect(
			await detectWideGamut(asArrayBuffer(bytes([0xff, 0xd8], [0xff, 0xda, 0, 4, 1, 2], [0, 0])))
		).toBeNull();
		expect(await detectWideGamut(asArrayBuffer(bytes('GIF89a', new Uint8Array(20))))).toBeNull();
		expect(await detectWideGamut(new ArrayBuffer(4))).toBeNull();
		// Truncated ICC inside a valid JPEG wrapper.
		expect(await detectWideGamut(asArrayBuffer(jpegWithIcc(new Uint8Array([1, 2, 3]))))).toBeNull();
	});
});

describe('detectColorSpace', () => {
	const asArrayBuffer = (b: Uint8Array) =>
		b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;

	it('maps display names to machine space ids', async () => {
		expect(await detectColorSpace(asArrayBuffer(jpegWithIcc(iccV4('Display P3'))))).toMatchObject({
			name: 'Display P3',
			space: 'display-p3'
		});
		expect(await detectColorSpace(asArrayBuffer(tiffWithIcc(iccV2('ProPhoto RGB'))))).toMatchObject(
			{ name: 'ProPhoto RGB', space: 'prophoto' }
		);
	});

	it('carries the nclx transfer through (PQ HEIC stays detectable but flagged)', async () => {
		const pq = heicWithColr(bytes('nclx', u16(12), u16(16), u16(6), [0x80]));
		expect(await detectColorSpace(asArrayBuffer(pq))).toMatchObject({
			name: 'Display P3',
			space: 'display-p3',
			transfer: 16
		});
		const srgb = heicWithColr(bytes('nclx', u16(12), u16(13), u16(6), [0x80]));
		expect((await detectColorSpace(asArrayBuffer(srgb)))?.transfer).toBe(13);
	});

	it('classifies nclx 11 as DCI-P3 (excluded from conversion, kept for the note)', async () => {
		const dci = heicWithColr(bytes('nclx', u16(11), u16(13), u16(6), [0x80]));
		expect(await detectColorSpace(asArrayBuffer(dci))).toMatchObject({
			name: 'DCI-P3',
			space: 'dci-p3'
		});
	});
});

describe('isWasmDecodedSource', () => {
	const asArrayBuffer = (b: Uint8Array) =>
		b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;

	it('flags TIFF and HEIC, not AVIF or browser formats', () => {
		expect(isWasmDecodedSource(asArrayBuffer(tiffWithIcc(iccV2('x'))))).toBe(true);
		expect(isWasmDecodedSource(asArrayBuffer(box('ftyp', 'heic', u32(0), 'heicmif1')))).toBe(true);
		expect(isWasmDecodedSource(asArrayBuffer(box('ftyp', 'mif1', u32(0), 'mif1heic')))).toBe(true);
		expect(isWasmDecodedSource(asArrayBuffer(box('ftyp', 'avif', u32(0), 'avifmif1')))).toBe(false);
		expect(isWasmDecodedSource(asArrayBuffer(box('ftyp', 'avis', u32(0), 'avismif1')))).toBe(false);
		expect(isWasmDecodedSource(asArrayBuffer(bytes([0xff, 0xd8], new Uint8Array(16))))).toBe(false);
		expect(isWasmDecodedSource(asArrayBuffer(bytes(PNG_SIG, new Uint8Array(16))))).toBe(false);
	});
});
