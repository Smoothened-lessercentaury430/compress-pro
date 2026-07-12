import { describe, expect, it } from 'vitest';
import { buildMinimalExifTiff, crc32, stripJpegBytes, stripPngBytes, stripWebpBytes } from './exif';
import { readExifSummary } from './exif-parse';

// --- test-side byte builders (deliberately independent of the module) ------

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

const seg = (marker: number, payload: Uint8Array | number[] | string): Uint8Array => {
	const body = bytes(payload);
	return bytes([0xff, marker, (body.length + 2) >> 8, (body.length + 2) & 0xff], body);
};

/** Big-endian TIFF with Make/Model/Orientation + GPS IFD (independent writer). */
function testExifTiff(opts: {
	make?: string;
	orientation?: number;
	gps?: {
		lat: [number, number, number];
		latRef: string;
		lon: [number, number, number];
		lonRef: string;
	};
}): Uint8Array {
	const entries: number[][] = [];
	const tail: number[] = [];
	// layout: 8 header + 2 count + N*12 + 4 next; values appended after.
	const count = (opts.make ? 1 : 0) + (opts.orientation ? 1 : 0) + (opts.gps ? 1 : 0);
	let valueAt = 8 + 2 + count * 12 + 4;

	const u16 = (n: number) => [n >> 8, n & 0xff];
	const u32 = (n: number) => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];

	if (opts.make) {
		const text = opts.make + '\0';
		entries.push([...u16(0x010f), ...u16(2), ...u32(text.length), ...u32(valueAt)]);
		tail.push(...new TextEncoder().encode(text));
		valueAt += text.length;
	}
	if (opts.orientation) {
		entries.push([...u16(0x0112), ...u16(3), ...u32(1), ...u16(opts.orientation), 0, 0]);
	}
	if (opts.gps) {
		// GPS IFD: latRef, lat(3 RATIONAL), lonRef, lon — laid out after values.
		const gpsIfdAt = valueAt;
		entries.push([...u16(0x8825), ...u16(4), ...u32(1), ...u32(gpsIfdAt)]);
		const rat = (vals: [number, number, number]) =>
			vals.flatMap((v) => [...u32(Math.round(v * 1000)), ...u32(1000)]);
		const latAt = gpsIfdAt + 2 + 4 * 12 + 4;
		const lonAt = latAt + 24;
		tail.push(
			...u16(4),
			...u16(0x0001),
			...u16(2),
			...u32(2),
			opts.gps.latRef.charCodeAt(0),
			0,
			0,
			0,
			...u16(0x0002),
			...u16(5),
			...u32(3),
			...u32(latAt),
			...u16(0x0003),
			...u16(2),
			...u32(2),
			opts.gps.lonRef.charCodeAt(0),
			0,
			0,
			0,
			...u16(0x0004),
			...u16(5),
			...u32(3),
			...u32(lonAt),
			...u32(0),
			...rat(opts.gps.lat),
			...rat(opts.gps.lon)
		);
	}

	return bytes([0x4d, 0x4d, 0x00, 0x2a, ...u32(8), ...u16(count)], entries.flat(), u32(0), tail);
}

const exifApp1 = (tiff: Uint8Array) => seg(0xe1, bytes('Exif\0\0', tiff));
const APP0 = seg(0xe0, bytes('JFIF\0', [1, 2, 0, 0, 72, 0, 72, 0, 0]));
const DQT = seg(0xdb, new Uint8Array(65));
// SOS with fake entropy containing an FF E1 lookalike, ending with EOI.
const SOS_TAIL = bytes(
	[0xff, 0xda, 0x00, 0x04, 0x01, 0x02],
	[0x11, 0xff, 0xe1, 0x33],
	[0xff, 0xd9]
);

const pngChunk = (type: string, payload: Uint8Array | number[] | string): Uint8Array => {
	const body = bytes(payload);
	const typeAndData = bytes(type, body);
	const crc = crc32(typeAndData);
	return bytes(
		[
			body.length >>> 24,
			(body.length >>> 16) & 0xff,
			(body.length >>> 8) & 0xff,
			body.length & 0xff
		],
		typeAndData,
		[(crc >>> 24) & 0xff, (crc >>> 16) & 0xff, (crc >>> 8) & 0xff, crc & 0xff]
	);
};
const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const IHDR = pngChunk('IHDR', [0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0]);
const IDAT = pngChunk('IDAT', [1, 2, 3, 4]);
const IEND = pngChunk('IEND', []);

const webpChunk = (type: string, payload: Uint8Array | number[] | string): Uint8Array => {
	const body = bytes(payload);
	const chunk = bytes(
		type,
		[
			body.length & 0xff,
			(body.length >> 8) & 0xff,
			(body.length >> 16) & 0xff,
			(body.length >> 24) & 0xff
		],
		body
	);
	return body.length % 2 ? bytes(chunk, [0]) : chunk;
};
const webpFile = (...chunks: Uint8Array[]): Uint8Array => {
	const body = bytes(...chunks);
	const size = body.length + 4;
	return bytes(
		'RIFF',
		[size & 0xff, (size >> 8) & 0xff, (size >> 16) & 0xff, (size >> 24) & 0xff],
		'WEBP',
		body
	);
};

const OPTS = { removeIcc: false };

// ---------------------------------------------------------------------------

describe('stripJpegBytes', () => {
	it('returns identical bytes when there is nothing to remove', () => {
		const input = bytes([0xff, 0xd8], APP0, DQT, SOS_TAIL);
		const out = stripJpegBytes(input, OPTS);
		expect(Buffer.from(out.bytes).equals(Buffer.from(input))).toBe(true);
		expect(out.removed.exif).toBe(0);
	});

	it('drops the Exif APP1 and keeps every other segment byte-identical', () => {
		const tiff = testExifTiff({ make: 'Apple' });
		const input = bytes([0xff, 0xd8], APP0, exifApp1(tiff), DQT, SOS_TAIL);
		const out = stripJpegBytes(input, OPTS);
		expect(
			Buffer.from(out.bytes).equals(Buffer.from(bytes([0xff, 0xd8], APP0, DQT, SOS_TAIL)))
		).toBe(true);
		expect(out.removed.exif).toBe(1);
		expect(out.summary?.make).toBe('Apple');
	});

	it('drops multiple APP1s (Exif + XMP) and counts both', () => {
		const xmp = seg(0xe1, 'http://ns.adobe.com/xap/1.0/\0<xml/>');
		const input = bytes([0xff, 0xd8], exifApp1(testExifTiff({ make: 'X' })), xmp, DQT, SOS_TAIL);
		const out = stripJpegBytes(input, OPTS);
		expect(out.removed.exif).toBe(1);
		expect(out.removed.xmp).toBe(1);
		expect(out.bytes.length).toBe(2 + DQT.length + SOS_TAIL.length);
	});

	it('XMP-only file gets no orientation splice', () => {
		const xmp = seg(0xe1, 'http://ns.adobe.com/xap/1.0/\0<xml/>');
		const input = bytes([0xff, 0xd8], APP0, xmp, DQT, SOS_TAIL);
		const out = stripJpegBytes(input, OPTS);
		expect(out.removed.xmp).toBe(1);
		// Exactly the input minus the XMP segment — no splice added.
		expect(
			Buffer.from(out.bytes).equals(Buffer.from(bytes([0xff, 0xd8], APP0, DQT, SOS_TAIL)))
		).toBe(true);
	});

	it('drops COM and Photoshop APP13', () => {
		const com = seg(0xfe, 'shot on my phone');
		const app13 = seg(0xed, bytes('Photoshop 3.0\0', [0x38, 0x42, 0x49, 0x4d]));
		const input = bytes([0xff, 0xd8], APP0, com, app13, DQT, SOS_TAIL);
		const out = stripJpegBytes(input, OPTS);
		expect(out.removed.comments).toBe(1);
		expect(out.removed.app13).toBe(1);
	});

	it('keeps multi-segment ICC by default, drops all parts with removeIcc; MPF kept when nothing shifts behind it', () => {
		const icc1 = seg(0xe2, bytes('ICC_PROFILE\0', [1, 2], new Uint8Array(10)));
		const icc2 = seg(0xe2, bytes('ICC_PROFILE\0', [2, 2], new Uint8Array(10)));
		const mpf = seg(0xe2, bytes('MPF\0', new Uint8Array(6)));
		const input = bytes([0xff, 0xd8], APP0, icc1, icc2, mpf, DQT, SOS_TAIL);

		const kept = stripJpegBytes(input, { removeIcc: false });
		expect(kept.removed.icc).toBe(0);
		expect(Buffer.from(kept.bytes).equals(Buffer.from(input))).toBe(true);

		// Removals BEFORE the MPF shift it and the trailing bytes equally, so
		// even this garbage MPF payload is kept verbatim (no rewrite needed).
		const stripped = stripJpegBytes(input, { removeIcc: true });
		expect(stripped.removed.icc).toBe(2);
		expect(stripped.mpfDropped).toBeFalsy();
		expect(
			Buffer.from(stripped.bytes).equals(Buffer.from(bytes([0xff, 0xd8], APP0, mpf, DQT, SOS_TAIL)))
		).toBe(true);
	});

	it('copies post-SOS bytes verbatim (FF E1 lookalikes) and tolerates a missing EOI', () => {
		const noEoi = bytes([0xff, 0xda, 0x00, 0x04, 0x01, 0x02], [0xff, 0xe1, 0x00, 0x10]);
		const input = bytes([0xff, 0xd8], exifApp1(testExifTiff({ make: 'X' })), noEoi);
		const out = stripJpegBytes(input, OPTS);
		expect(Buffer.from(out.bytes.subarray(2)).equals(Buffer.from(noEoi))).toBe(true);
	});

	it('handles JFIF-less JPEGs: splice lands right after SOI', () => {
		const input = bytes([0xff, 0xd8], exifApp1(testExifTiff({ orientation: 6 })), DQT, SOS_TAIL);
		const out = stripJpegBytes(input, OPTS);
		// Output: SOI + minimal APP1 (36 bytes) + DQT + SOS.
		expect(out.bytes[2]).toBe(0xff);
		expect(out.bytes[3]).toBe(0xe1);
		expect(out.bytes[4]).toBe(0x00);
		expect(out.bytes[5]).toBe(0x22); // length 34
		const reparsed = readExifSummary(out.bytes.subarray(6, 6 + 32));
		expect(reparsed.orientation).toBe(6);
		expect(reparsed.fieldCount).toBe(1);
	});

	it('orientation 6 splices after APP0; orientation 1 does not splice', () => {
		const with6 = stripJpegBytes(
			bytes([0xff, 0xd8], APP0, exifApp1(testExifTiff({ orientation: 6 })), DQT, SOS_TAIL),
			OPTS
		);
		// After SOI+APP0 comes the minimal APP1.
		const app0End = 2 + APP0.length;
		expect(with6.bytes[app0End]).toBe(0xff);
		expect(with6.bytes[app0End + 1]).toBe(0xe1);

		const with1 = stripJpegBytes(
			bytes([0xff, 0xd8], APP0, exifApp1(testExifTiff({ orientation: 1 })), DQT, SOS_TAIL),
			OPTS
		);
		expect(with1.bytes[app0End]).not.toBe(0xff & with1.bytes[app0End] && 0xe1);
		expect(with1.bytes.length).toBe(2 + APP0.length + DQT.length + SOS_TAIL.length);
	});

	it('flags truncated EXIF as unreadable but still strips it', () => {
		const broken = seg(0xe1, bytes('Exif\0\0', [0x4d, 0x4d, 0x00])); // cut-off TIFF
		const input = bytes([0xff, 0xd8], APP0, broken, DQT, SOS_TAIL);
		const out = stripJpegBytes(input, OPTS);
		expect(out.unreadable).toBe(true);
		expect(out.removed.exif).toBe(1);
	});
});

// --- MPF offset rewrite ------------------------------------------------------

/**
 * Big-endian MPF TIFF with two MP entries (independent writer). Layout:
 * 8 header + 2 count + 3×12 entries + 4 next-IFD + 32 entry data = 82 bytes.
 */
function testMpfTiff(second: { size: number; offset: number }): Uint8Array {
	const u16 = (n: number) => [n >> 8, n & 0xff];
	const u32 = (n: number) => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
	const VALUE_AT = 8 + 2 + 3 * 12 + 4;
	return bytes(
		[0x4d, 0x4d, 0x00, 0x2a], // 'MM' 42
		u32(8), // IFD0 at 8
		u16(3),
		// 0xB000 MPFVersion: UNDEFINED ×4, inline "0100"
		[...u16(0xb000), ...u16(7), ...u32(4)],
		'0100',
		// 0xB001 NumberOfImages: LONG 2
		[...u16(0xb001), ...u16(4), ...u32(1), ...u32(2)],
		// 0xB002 MP Entry: UNDEFINED ×32 at VALUE_AT
		[...u16(0xb002), ...u16(7), ...u32(32), ...u32(VALUE_AT)],
		u32(0), // next IFD
		// entry 1 — primary image: offset 0 by spec
		[...u32(0x030000), ...u32(1234), ...u32(0), ...u16(0), ...u16(0)],
		// entry 2 — secondary image (the one whose offset must track surgery)
		[...u32(0x000000), ...u32(second.size), ...u32(second.offset), ...u16(0), ...u16(0)]
	);
}

const mpfApp2 = (tiff: Uint8Array) => seg(0xe2, bytes('MPF\0', tiff));

describe('stripJpegBytes MPF offset rewrite', () => {
	// Fake trailing secondary image appended after the primary's EOI.
	const TRAILING = bytes([0xff, 0xd8], [0xaa, 0xbb, 0xcc, 0xdd], [0xff, 0xd9]);
	const XMP = seg(0xe1, 'http://ns.adobe.com/xap/1.0/\0<xml/>');

	function buildFixture() {
		// Layout: SOI APP0 [MPF] [XMP] DQT SOS_TAIL TRAILING — the XMP sits
		// BETWEEN the MPF header and the bytes its offsets point at.
		const mpfSegLength = 2 + 2 + 4 + 82; // marker + len + 'MPF\0' + TIFF
		const tiffStart = 2 + APP0.length + 4 + 4; // TIFF header inside the segment
		const trailingStart =
			2 + APP0.length + mpfSegLength + XMP.length + DQT.length + SOS_TAIL.length;
		const secondOffset = trailingStart - tiffStart;
		const mpf = mpfApp2(testMpfTiff({ size: TRAILING.length, offset: secondOffset }));
		expect(mpf.length).toBe(mpfSegLength); // builder sanity
		const input = bytes([0xff, 0xd8], APP0, mpf, XMP, DQT, SOS_TAIL, TRAILING);
		return { input, tiffStart, secondOffset };
	}

	it('shifts the secondary-image offset by exactly the bytes removed after the MPF header', () => {
		const { input, tiffStart, secondOffset } = buildFixture();
		const out = stripJpegBytes(input, OPTS);
		expect(out.removed.xmp).toBe(1);
		expect(out.mpfDropped).toBeFalsy();

		// The MPF segment stays at the same place (nothing before it changed).
		const view = new DataView(out.bytes.buffer, out.bytes.byteOffset);
		const entry2OffsetField = tiffStart + 50 + 16 + 8; // value area + entry 2 + dataOffset
		const rewritten = view.getUint32(entry2OffsetField, false);
		expect(rewritten).toBe(secondOffset - XMP.length);

		// …and it points at the trailing secondary image byte-for-byte.
		const at = tiffStart + rewritten;
		expect(Buffer.from(out.bytes.subarray(at, at + TRAILING.length))).toEqual(
			Buffer.from(TRAILING)
		);

		// Primary entry offset stays 0 by spec.
		expect(view.getUint32(tiffStart + 50 + 8, false)).toBe(0);
	});

	it('leaves offsets alone when removals happen only BEFORE the MPF', () => {
		const mpfSegLength = 2 + 2 + 4 + 82;
		const tiffStartAfterStrip = 2 + APP0.length + 8;
		const trailingStart =
			2 + APP0.length + XMP.length + mpfSegLength + DQT.length + SOS_TAIL.length;
		// Offsets are TIFF-relative, so compute against the INPUT position too.
		const tiffStartInput = 2 + APP0.length + XMP.length + 8;
		const secondOffset = trailingStart - tiffStartInput;
		const mpf = mpfApp2(testMpfTiff({ size: TRAILING.length, offset: secondOffset }));
		const input = bytes([0xff, 0xd8], APP0, XMP, mpf, DQT, SOS_TAIL, TRAILING);

		const out = stripJpegBytes(input, OPTS);
		const view = new DataView(out.bytes.buffer, out.bytes.byteOffset);
		const rewritten = view.getUint32(tiffStartAfterStrip + 50 + 16 + 8, false);
		expect(rewritten, 'both MPF and tail shifted equally — offset unchanged').toBe(secondOffset);
		const at = tiffStartAfterStrip + rewritten;
		expect(Buffer.from(out.bytes.subarray(at, at + TRAILING.length))).toEqual(
			Buffer.from(TRAILING)
		);
	});

	it('drops an unparseable MPF instead of shipping stale offsets', () => {
		const garbageMpf = seg(0xe2, bytes('MPF\0', new Uint8Array(6)));
		const input = bytes([0xff, 0xd8], APP0, garbageMpf, XMP, DQT, SOS_TAIL, TRAILING);
		const out = stripJpegBytes(input, OPTS);
		expect(out.mpfDropped).toBe(true);
		expect(Buffer.from(out.bytes).includes(Buffer.from('MPF\0', 'latin1'))).toBe(false);
		// Everything else survives untouched.
		expect(
			Buffer.from(out.bytes).equals(Buffer.from(bytes([0xff, 0xd8], APP0, DQT, SOS_TAIL, TRAILING)))
		).toBe(true);
	});
});

describe('stripPngBytes', () => {
	it('drops text/time/eXIf chunks, keeps the image chunks with original CRCs', () => {
		const input = bytes(
			PNG_SIG,
			IHDR,
			pngChunk('tEXt', 'Author\0Nik'),
			pngChunk('zTXt', [0, 0, 1]),
			pngChunk('iTXt', 'XML:com.adobe.xmp\0\0\0\0\0<x/>'),
			pngChunk('tIME', [7, 234, 7, 10, 12, 0, 0]),
			pngChunk('eXIf', testExifTiff({ make: 'Canon' })),
			pngChunk('pHYs', [0, 0, 11, 19, 0, 0, 11, 19, 1]),
			IDAT,
			IEND
		);
		const out = stripPngBytes(input, OPTS);
		expect(out.removed.textChunks).toBe(4);
		expect(out.removed.exif).toBe(1);
		expect(out.summary?.make).toBe('Canon');
		expect(
			Buffer.from(out.bytes).equals(
				Buffer.from(
					bytes(PNG_SIG, IHDR, pngChunk('pHYs', [0, 0, 11, 19, 0, 0, 11, 19, 1]), IDAT, IEND)
				)
			)
		).toBe(true);
	});

	it('drops iCCP only with removeIcc', () => {
		const input = bytes(PNG_SIG, IHDR, pngChunk('iCCP', bytes('p3\0', [0, 1, 2])), IDAT, IEND);
		expect(stripPngBytes(input, { removeIcc: false }).removed.icc).toBe(0);
		expect(stripPngBytes(input, { removeIcc: true }).removed.icc).toBe(1);
	});

	it('re-embeds orientation as a fresh eXIf chunk after IHDR with a valid CRC', () => {
		const input = bytes(
			PNG_SIG,
			IHDR,
			pngChunk('eXIf', testExifTiff({ orientation: 6 })),
			IDAT,
			IEND
		);
		const out = stripPngBytes(input, OPTS);
		const at = 8 + IHDR.length;
		expect(String.fromCharCode(...out.bytes.subarray(at + 4, at + 8))).toBe('eXIf');
		const length = new DataView(out.bytes.buffer, out.bytes.byteOffset + at).getUint32(0, false);
		expect(length).toBe(26);
		const tiff = out.bytes.subarray(at + 8, at + 8 + 26);
		expect(readExifSummary(tiff).orientation).toBe(6);
		const storedCrc = new DataView(out.bytes.buffer, out.bytes.byteOffset + at + 8 + 26).getUint32(
			0,
			false
		);
		expect(storedCrc).toBe(crc32(out.bytes.subarray(at + 4, at + 8 + 26)));
	});

	it('anchors crc32 against known constants', () => {
		expect(crc32(new TextEncoder().encode('IEND'))).toBe(0xae426082);
		expect(crc32(new Uint8Array(0))).toBe(0);
	});
});

describe('stripWebpBytes', () => {
	const VP8X = (flags: number) => webpChunk('VP8X', [flags, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
	const VP8 = webpChunk('VP8 ', new Uint8Array(20));

	it('drops EXIF and XMP, clears the VP8X flag bits, fixes riffSize', () => {
		const input = webpFile(
			VP8X(0x08 | 0x04 | 0x10),
			VP8,
			webpChunk('EXIF', testExifTiff({ make: 'Google' })),
			webpChunk('XMP ', 'x'.repeat(7)) // odd payload → pad byte
		);
		const out = stripWebpBytes(input, OPTS);
		expect(out.removed.exif).toBe(1);
		expect(out.removed.xmp).toBe(1);
		expect(out.bytes[20] & 0x08).toBe(0);
		expect(out.bytes[20] & 0x04).toBe(0);
		expect(out.bytes[20] & 0x10).toBe(0x10); // alpha untouched
		const riffSize = new DataView(out.bytes.buffer, out.bytes.byteOffset).getUint32(4, true);
		expect(riffSize).toBe(out.bytes.length - 8);
		expect(Buffer.from(out.bytes).equals(Buffer.from(webpFile(VP8X(0x10), VP8)))).toBe(true);
	});

	it('drops ICCP + clears 0x20 only with removeIcc', () => {
		const input = webpFile(
			VP8X(0x20 | 0x08),
			webpChunk('ICCP', [1, 2, 3, 4]),
			VP8,
			webpChunk('EXIF', testExifTiff({}))
		);
		const kept = stripWebpBytes(input, { removeIcc: false });
		expect(kept.removed.icc).toBe(0);
		expect(kept.bytes[20] & 0x20).toBe(0x20);
		const stripped = stripWebpBytes(input, { removeIcc: true });
		expect(stripped.removed.icc).toBe(1);
		expect(stripped.bytes[20] & 0x20).toBe(0);
	});

	it('returns a bare VP8 file untouched (fast path)', () => {
		const input = webpFile(VP8);
		const out = stripWebpBytes(input, OPTS);
		expect(out.bytes).toBe(input);
	});

	it('re-embeds orientation as an EXIF chunk and keeps flag 0x08', () => {
		const input = webpFile(VP8X(0x08), VP8, webpChunk('EXIF', testExifTiff({ orientation: 6 })));
		const out = stripWebpBytes(input, OPTS);
		expect(out.bytes[20] & 0x08).toBe(0x08);
		// Last chunk is the minimal EXIF (26-byte payload).
		const tail = out.bytes.subarray(out.bytes.length - 34);
		expect(String.fromCharCode(...tail.subarray(0, 4))).toBe('EXIF');
		expect(readExifSummary(tail.subarray(8)).orientation).toBe(6);
	});
});

describe('buildMinimalExifTiff ↔ readExifSummary', () => {
	it('round-trips every orientation 1-8 with a single field', () => {
		for (let o = 1; o <= 8; o++) {
			const summary = readExifSummary(buildMinimalExifTiff(o));
			expect(summary.orientation).toBe(o);
			expect(summary.fieldCount).toBe(1);
			expect(summary.gps).toBeNull();
		}
	});
});

describe('readExifSummary GPS', () => {
	it('converts rationals to decimal degrees with S/W negation', () => {
		const tiff = testExifTiff({
			gps: { lat: [46, 3, 3.96], latRef: 'N', lon: [14, 30, 18.36], lonRef: 'E' }
		});
		const s = readExifSummary(tiff);
		expect(s.gps?.lat).toBeCloseTo(46.0511, 3);
		expect(s.gps?.lon).toBeCloseTo(14.5051, 3);

		const south = testExifTiff({
			gps: { lat: [33, 51, 0], latRef: 'S', lon: [151, 12, 0], lonRef: 'W' }
		});
		const s2 = readExifSummary(south);
		expect(s2.gps?.lat).toBeLessThan(0);
		expect(s2.gps?.lon).toBeLessThan(0);
	});

	it('throws on garbage instead of hanging', () => {
		expect(() => readExifSummary(new Uint8Array([1, 2, 3]))).toThrow();
		const badOffset = bytes([0x4d, 0x4d, 0x00, 0x2a, 0xff, 0xff, 0xff, 0xff]);
		expect(() => readExifSummary(badOffset)).toThrow();
	});

	it('reads a ~70 KB ASCII tag without blowing the argument limit', () => {
		// String.fromCharCode(...spread) dies around 65k args; TextDecoder must not.
		const make = 'A'.repeat(70_000);
		const summary = readExifSummary(testExifTiff({ make }));
		expect(summary.make?.length).toBe(70_000);
		expect(summary.make).toBe(make);
	});
});
