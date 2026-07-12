import { describe, expect, it } from 'vitest';
import { exifPayloadForReencode, spliceExifIntoImage } from './exif-copy';
import { readExifSummary, TiffReader } from './exif-parse';

// --- builders ---------------------------------------------------------------

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

const ab = (b: Uint8Array) =>
	b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;

const u16 = (n: number) => [(n >> 8) & 0xff, n & 0xff];
const u32 = (n: number) => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
const u16le = (n: number) => [n & 0xff, (n >> 8) & 0xff];
const u32le = (n: number) => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff];

/**
 * Little-endian TIFF with a realistic layout: IFD0 (Make, Orientation,
 * ExifIFD pointer) → make string → ExifIFD (ColorSpace) → optional IFD1 +
 * thumbnail bytes at the very end (truncatable).
 */
function buildTiff({ orientation = 6, withThumbnail = true } = {}): Uint8Array {
	const IFD0 = 8;
	const IFD0_END = IFD0 + 2 + 3 * 12 + 4; // 50
	const MAKE = IFD0_END; // "Apple\0" (6)
	const EXIF_IFD = MAKE + 6; // 56
	const EXIF_END = EXIF_IFD + 2 + 12 + 4; // 74
	const IFD1 = withThumbnail ? EXIF_END : 0; // 74
	const THUMB = IFD1 ? IFD1 + 2 + 12 + 4 : 0; // 92
	const total = withThumbnail ? THUMB + 40 : EXIF_END;

	const t = new Uint8Array(total);
	const v = new DataView(t.buffer);
	t[0] = 0x49;
	t[1] = 0x49;
	v.setUint16(2, 42, true);
	v.setUint32(4, IFD0, true);

	// IFD0: 3 entries, ascending tags.
	v.setUint16(IFD0, 3, true);
	let at = IFD0 + 2;
	// 0x010F Make, ASCII ×6 → offset value
	v.setUint16(at, 0x010f, true);
	v.setUint16(at + 2, 2, true);
	v.setUint32(at + 4, 6, true);
	v.setUint32(at + 8, MAKE, true);
	at += 12;
	// 0x0112 Orientation, SHORT ×1 inline
	v.setUint16(at, 0x0112, true);
	v.setUint16(at + 2, 3, true);
	v.setUint32(at + 4, 1, true);
	v.setUint16(at + 8, orientation, true);
	at += 12;
	// 0x8769 ExifIFD pointer, LONG ×1
	v.setUint16(at, 0x8769, true);
	v.setUint16(at + 2, 4, true);
	v.setUint32(at + 4, 1, true);
	v.setUint32(at + 8, EXIF_IFD, true);
	at += 12;
	v.setUint32(at, IFD1, true); // next IFD (0 = none)

	t.set(new TextEncoder().encode('Apple\0'), MAKE);

	// ExifIFD: 0xA001 ColorSpace = 2 (Adobe RGB-ish, must become 1).
	v.setUint16(EXIF_IFD, 1, true);
	v.setUint16(EXIF_IFD + 2, 0xa001, true);
	v.setUint16(EXIF_IFD + 4, 3, true);
	v.setUint32(EXIF_IFD + 6, 1, true);
	v.setUint16(EXIF_IFD + 10, 2, true);
	v.setUint32(EXIF_IFD + 14, 0, true); // no next IFD

	if (withThumbnail) {
		// IFD1: one Compression tag + trailing "thumbnail" garbage.
		v.setUint16(IFD1, 1, true);
		v.setUint16(IFD1 + 2, 0x0103, true);
		v.setUint16(IFD1 + 4, 3, true);
		v.setUint32(IFD1 + 6, 1, true);
		v.setUint16(IFD1 + 10, 6, true);
		v.setUint32(IFD1 + 14, 0, true);
		t.fill(0xab, THUMB);
	}
	return t;
}

const jpegSeg = (marker: number, payload: Uint8Array | number[] | string): Uint8Array => {
	const body = bytes(payload);
	return bytes([0xff, marker], u16(body.length + 2), body);
};

const SOI = [0xff, 0xd8];
const SOS_TAIL = [0xff, 0xda, 0x00, 0x04, 0x01, 0x02, 0x11, 0x22, 0xff, 0xd9];

const jpegWith = (...segments: Uint8Array[]) => bytes(SOI, ...segments, SOS_TAIL);
const app0 = () => jpegSeg(0xe0, bytes('JFIF\0', new Uint8Array(9)));

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const pngChunk = (type: string, payload: Uint8Array | number[]): Uint8Array => {
	const body = bytes(payload);
	return bytes(u32(body.length), type, body, u32(0));
};
const pngWith = (...extra: Uint8Array[]) =>
	bytes(
		PNG_SIG,
		pngChunk('IHDR', bytes(u32(4), u32(3), [8, 6, 0, 0, 0])),
		...extra,
		pngChunk('IDAT', [1, 2, 3]),
		pngChunk('IEND', [])
	);

const webpChunk = (type: string, payload: Uint8Array | number[]): Uint8Array => {
	const body = bytes(payload);
	const padded = body.length % 2 ? bytes(body, [0]) : body;
	return bytes(type, u32le(body.length), padded);
};
const riff = (...chunks: Uint8Array[]): Uint8Array => {
	const body = bytes('WEBP', ...chunks);
	return bytes('RIFF', u32le(body.length), body);
};
const vp8Frame = (w: number, h: number) =>
	webpChunk('VP8 ', bytes([0, 0, 0], [0x9d, 0x01, 0x2a], u16le(w), u16le(h), new Uint8Array(6)));

const box = (type: string, ...payload: (Uint8Array | number[] | string)[]): Uint8Array => {
	const body = bytes(...payload);
	return bytes(u32(body.length + 8), type, body);
};

/** HEIC-shaped container with an Exif item; method 0 = absolute file offsets. */
function heicWithExif(tiff: Uint8Array, { method = 0 as 0 | 1 } = {}): Uint8Array {
	const exifItem = bytes(u32(6), 'Exif\0\0', tiff); // ExifDataBlock: offset 6 → TIFF
	const ftyp = box('ftyp', 'heic', u32(0), 'heicmif1');
	const infe = box('infe', [2, 0, 0, 0], u16(1), u16(0), 'Exif\0');
	const iinf = box('iinf', [0, 0, 0, 0], u16(1), infe);

	// Assemble twice: first pass with offset 0 to measure, second with the
	// real payload offset (iloc stores absolute file offsets for method 0).
	const build = (offset: number) => {
		const ilocBody =
			method === 0
				? bytes(
						[1, 0, 0, 0], // version 1 + flags
						[0x44, 0x00], // offset_size 4, length_size 4, base_offset_size 0, index_size 0
						u16(1), // item count
						u16(1), // item id
						u16(0), // construction_method 0
						u16(0), // data_reference_index
						u16(1), // extent count
						u32(offset),
						u32(exifItem.length)
					)
				: bytes(
						[1, 0, 0, 0],
						[0x44, 0x00],
						u16(1),
						u16(1),
						u16(1), // construction_method 1 (idat-relative)
						u16(0),
						u16(1),
						u32(0), // offset within idat
						u32(exifItem.length)
					);
		const iloc = box('iloc', ilocBody);
		const metaChildren =
			method === 1 ? bytes(iinf, iloc, box('idat', exifItem)) : bytes(iinf, iloc);
		const meta = box('meta', u32(0), metaChildren);
		return method === 1 ? bytes(ftyp, meta) : bytes(ftyp, meta, box('mdat', exifItem));
	};
	if (method === 1) return build(0);
	const probe = build(0);
	// mdat payload starts after everything before it + mdat's 8-byte header.
	const mdatPayloadAt = probe.length - exifItem.length;
	return build(mdatPayloadAt);
}

// --- helpers ----------------------------------------------------------------

function colorSpaceTag(tiff: Uint8Array): number | null {
	const reader = new TiffReader(tiff);
	const ifd0 = reader.readIfd(reader.ifd0Offset());
	const pointer = ifd0.get(0x8769);
	if (!pointer) return null;
	const exifIfd = reader.readIfd(reader.u32(pointer.valueOffset));
	const entry = exifIfd.get(0xa001);
	return entry ? reader.ushort(entry) : null;
}

// --- tests ------------------------------------------------------------------

describe('exifPayloadForReencode', () => {
	it('extracts from JPEG, neutralizes orientation + ColorSpace, drops IFD1', () => {
		const tiff = buildTiff({ orientation: 6, withThumbnail: true });
		const jpeg = jpegWith(app0(), jpegSeg(0xe1, bytes('Exif\0\0', tiff)));
		const out = exifPayloadForReencode(ab(jpeg))!;
		expect(out).not.toBeNull();
		const summary = readExifSummary(out);
		expect(summary.make).toBe('Apple');
		expect(summary.orientation).toBe(1); // was 6 — pixels are upright now
		expect(colorSpaceTag(out)).toBe(1); // was 2 — pixels are sRGB now
		expect(out.length).toBeLessThan(tiff.length); // thumbnail truncated
		// Next-IFD pointer zeroed.
		const reader = new TiffReader(out);
		const ifd0 = reader.readIfd(reader.ifd0Offset());
		expect(reader.u32(reader.ifd0Offset() + 2 + ifd0.size * 12)).toBe(0);
	});

	it('keeps payload size when IFD1 is absent', () => {
		const tiff = buildTiff({ orientation: 1, withThumbnail: false });
		const jpeg = jpegWith(jpegSeg(0xe1, bytes('Exif\0\0', tiff)));
		const out = exifPayloadForReencode(ab(jpeg))!;
		expect(out.length).toBe(tiff.length);
		expect(readExifSummary(out).make).toBe('Apple');
	});

	it('extracts from PNG eXIf and WebP EXIF (with and without the Exif\\0\\0 prefix)', () => {
		const tiff = buildTiff({ withThumbnail: false });
		const png = pngWith(pngChunk('eXIf', tiff));
		expect(readExifSummary(exifPayloadForReencode(ab(png))!).make).toBe('Apple');

		const bare = riff(vp8Frame(64, 48), webpChunk('EXIF', tiff));
		expect(readExifSummary(exifPayloadForReencode(ab(bare))!).make).toBe('Apple');
		const prefixed = riff(vp8Frame(64, 48), webpChunk('EXIF', bytes('Exif\0\0', tiff)));
		expect(readExifSummary(exifPayloadForReencode(ab(prefixed))!).make).toBe('Apple');
	});

	it('extracts the HEIF Exif item (construction methods 0 and 1)', () => {
		const tiff = buildTiff({ withThumbnail: false });
		for (const method of [0, 1] as const) {
			const heic = heicWithExif(tiff, { method });
			const out = exifPayloadForReencode(ab(heic));
			expect(out, `method ${method}`).not.toBeNull();
			expect(readExifSummary(out!).make, `method ${method}`).toBe('Apple');
			expect(readExifSummary(out!).orientation).toBe(1);
		}
	});

	it('returns null for TIFF sources, metadata-less and garbage inputs', () => {
		expect(exifPayloadForReencode(ab(buildTiff()))).toBeNull(); // raw TIFF file
		expect(exifPayloadForReencode(ab(jpegWith(app0())))).toBeNull();
		expect(exifPayloadForReencode(ab(pngWith()))).toBeNull();
		expect(exifPayloadForReencode(ab(riff(vp8Frame(8, 8))))).toBeNull();
		expect(exifPayloadForReencode(new ArrayBuffer(4))).toBeNull();
		expect(exifPayloadForReencode(ab(bytes('garbage-not-an-image', [0, 1, 2])))).toBeNull();
	});
});

describe('spliceExifIntoImage', () => {
	// What image.ts actually splices is the PREPARED payload (orientation and
	// ColorSpace already neutralized) — re-extraction is then idempotent, so
	// round-trips can assert byte equality.
	const tiff = exifPayloadForReencode(
		ab(
			jpegWith(
				jpegSeg(0xe1, bytes('Exif\0\0', buildTiff({ orientation: 1, withThumbnail: false })))
			)
		)
	)!;

	it('JPEG: inserts APP1 after the JFIF block; round-trips', () => {
		const encoded = jpegWith(app0());
		const spliced = spliceExifIntoImage(encoded, 'jpg', tiff)!;
		expect(spliced).not.toBeNull();
		// APP0 must still come first.
		expect(spliced[3]).toBe(0xe0);
		const back = exifPayloadForReencode(ab(spliced))!;
		expect(Array.from(back)).toEqual(Array.from(tiff));
	});

	it('JPEG: refuses payloads beyond the APP1 64 KB limit', () => {
		const huge = new Uint8Array(70_000);
		huge.set(buildTiff({ withThumbnail: false }));
		expect(spliceExifIntoImage(jpegWith(app0()), 'jpg', huge)).toBeNull();
	});

	it('PNG: inserts eXIf after IHDR with a valid CRC; round-trips', () => {
		const encoded = pngWith();
		const spliced = spliceExifIntoImage(encoded, 'png', tiff)!;
		const back = exifPayloadForReencode(ab(spliced))!;
		expect(Array.from(back)).toEqual(Array.from(tiff));
		// eXIf sits right after IHDR.
		expect(String.fromCharCode(...spliced.subarray(37, 41))).toBe('eXIf');
	});

	it('WebP: builds VP8X for a bare lossy VP8 file', () => {
		const encoded = riff(vp8Frame(320, 200));
		const spliced = spliceExifIntoImage(encoded, 'webp', tiff)!;
		expect(String.fromCharCode(...spliced.subarray(12, 16))).toBe('VP8X');
		expect(spliced[20] & 0x08, 'EXIF flag').toBe(0x08);
		expect(spliced[20] & 0x10, 'no alpha for bare VP8').toBe(0);
		// Canvas dims = frame dims − 1, u24 LE.
		expect(spliced[24] | (spliced[25] << 8) | (spliced[26] << 16)).toBe(319);
		expect(spliced[27] | (spliced[28] << 8) | (spliced[29] << 16)).toBe(199);
		// RIFF size covers everything after the 8-byte header.
		const riffSize =
			(spliced[4] | (spliced[5] << 8) | (spliced[6] << 16) | (spliced[7] << 24)) >>> 0;
		expect(riffSize).toBe(spliced.length - 8);
		const back = exifPayloadForReencode(ab(spliced))!;
		expect(Array.from(back)).toEqual(Array.from(tiff));
	});

	it('WebP: VP8L alpha bit propagates to the VP8X ALPHA flag', () => {
		const w = 100 - 1;
		const h = 80 - 1;
		const packed = ((w & 0x3fff) | ((h & 0x3fff) << 14) | (1 << 28)) >>> 0;
		const encoded = riff(webpChunk('VP8L', bytes([0x2f], u32le(packed), [0])));
		const spliced = spliceExifIntoImage(encoded, 'webp', tiff)!;
		expect(spliced[20] & 0x10, 'ALPHA flag').toBe(0x10);
		expect(spliced[24] | (spliced[25] << 8) | (spliced[26] << 16)).toBe(99);
	});

	it('WebP: existing VP8X gets the flag OR-ed and the chunk appended', () => {
		const vp8x = webpChunk('VP8X', bytes([0x10, 0, 0, 0], [63, 0, 0], [47, 0, 0]));
		const encoded = riff(vp8x, vp8Frame(64, 48));
		const spliced = spliceExifIntoImage(encoded, 'webp', tiff)!;
		expect(spliced[20] & 0x18, 'ALPHA kept + EXIF set').toBe(0x18);
		const back = exifPayloadForReencode(ab(spliced))!;
		expect(Array.from(back)).toEqual(Array.from(tiff));
	});

	it('returns null on structural surprises instead of corrupting output', () => {
		expect(spliceExifIntoImage(bytes('nope', new Uint8Array(30)), 'jpg', tiff)).toBeNull();
		expect(spliceExifIntoImage(bytes('nope', new Uint8Array(30)), 'png', tiff)).toBeNull();
		expect(spliceExifIntoImage(bytes('nope', new Uint8Array(30)), 'webp', tiff)).toBeNull();
	});
});
