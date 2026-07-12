import { describe, expect, it } from 'vitest';
import { buildMinimalExifTiff } from './exif';
import { probeDimensions } from './image-probe';

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
const u16le = (n: number) => [n & 0xff, (n >> 8) & 0xff];
const u24le = (n: number) => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff];
const u32 = (n: number) => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
const u32le = (n: number) => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff];

const jpegSeg = (marker: number, payload: Uint8Array | number[] | string): Uint8Array => {
	const body = bytes(payload);
	return bytes([0xff, marker], u16(body.length + 2), body);
};

/** SOF payload: precision(1) height(2) width(2) components(1)… */
const sof = (marker: number, width: number, height: number) =>
	jpegSeg(marker, bytes([8], u16(height), u16(width), [3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]));

const exifApp1 = (orientation: number) =>
	jpegSeg(0xe1, bytes('Exif\0\0', buildMinimalExifTiff(orientation)));

const SOI = [0xff, 0xd8];
const SOS = [0xff, 0xda, 0x00, 0x04, 0x01, 0x02];

describe('probeDimensions — JPEG', () => {
	it('reads baseline and progressive SOF dims', () => {
		expect(probeDimensions(ab(bytes(SOI, sof(0xc0, 5600, 3800), SOS)))).toEqual({
			width: 5600,
			height: 3800,
			orientation: 1
		});
		expect(probeDimensions(ab(bytes(SOI, sof(0xc2, 320, 200), SOS)))).toEqual({
			width: 320,
			height: 200,
			orientation: 1
		});
	});

	it('skips DHT (C4) and reads the EXIF orientation', () => {
		const dht = jpegSeg(0xc4, new Uint8Array(20));
		const probe = probeDimensions(ab(bytes(SOI, exifApp1(6), dht, sof(0xc0, 4000, 6000), SOS)));
		expect(probe).toEqual({ width: 4000, height: 6000, orientation: 6 });
	});

	it('ignores garbage orientation values and APP1s that are not EXIF', () => {
		const xmp = jpegSeg(0xe1, bytes('http://ns.adobe.com/xap/1.0/\0', new Uint8Array(10)));
		const probe = probeDimensions(ab(bytes(SOI, xmp, exifApp1(9), sof(0xc0, 100, 50), SOS)));
		expect(probe).toEqual({ width: 100, height: 50, orientation: 1 });
	});

	it('returns null without a SOF before SOS', () => {
		expect(probeDimensions(ab(bytes(SOI, exifApp1(1), SOS)))).toBeNull();
	});
});

describe('probeDimensions — PNG', () => {
	const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
	const chunk = (type: string, payload: Uint8Array | number[]): Uint8Array => {
		const body = bytes(payload);
		return bytes(u32(body.length), type, body, u32(0));
	};
	const ihdr = (w: number, h: number) => chunk('IHDR', bytes(u32(w), u32(h), [8, 6, 0, 0, 0]));

	it('reads IHDR dims', () => {
		const png = bytes(PNG_SIG, ihdr(4960, 3200), chunk('IDAT', [1]), chunk('IEND', []));
		expect(probeDimensions(ab(png))).toEqual({ width: 4960, height: 3200, orientation: 1 });
	});

	it('reads an eXIf orientation when present', () => {
		const png = bytes(
			PNG_SIG,
			ihdr(64, 32),
			chunk('eXIf', buildMinimalExifTiff(8)),
			chunk('IDAT', [1]),
			chunk('IEND', [])
		);
		expect(probeDimensions(ab(png))).toEqual({ width: 64, height: 32, orientation: 8 });
	});
});

describe('probeDimensions — WebP', () => {
	const riff = (...chunks: Uint8Array[]): Uint8Array => {
		const body = bytes('WEBP', ...chunks);
		return bytes('RIFF', u32le(body.length), body);
	};
	const chunk = (type: string, payload: Uint8Array | number[]): Uint8Array => {
		const body = bytes(payload);
		const padded = body.length % 2 ? bytes(body, [0]) : body;
		return bytes(type, u32le(body.length), padded);
	};

	it('reads VP8X canvas dims', () => {
		const vp8x = chunk('VP8X', bytes([0, 0, 0, 0], u24le(5183), u24le(3455)));
		expect(probeDimensions(ab(riff(vp8x, chunk('VP8 ', new Uint8Array(12)))))).toEqual({
			width: 5184,
			height: 3456,
			orientation: 1
		});
	});

	it('reads bare VP8 key-frame dims', () => {
		const frame = bytes([0, 0, 0], [0x9d, 0x01, 0x2a], u16le(1920), u16le(1080), [0, 0]);
		expect(probeDimensions(ab(riff(chunk('VP8 ', frame))))).toEqual({
			width: 1920,
			height: 1080,
			orientation: 1
		});
	});

	it('reads VP8L dims', () => {
		const w = 800 - 1;
		const h = 600 - 1;
		const packed = (w & 0x3fff) | ((h & 0x3fff) << 14);
		const payload = bytes([0x2f], u32le(packed), [0]);
		expect(probeDimensions(ab(riff(chunk('VP8L', payload))))).toEqual({
			width: 800,
			height: 600,
			orientation: 1
		});
	});
});

describe('probeDimensions — BMP/GIF/garbage', () => {
	it('reads BMP dims incl. top-down (negative height)', () => {
		const bmp = (h: number) =>
			bytes(
				'BM',
				u32le(100),
				u32le(0),
				u32le(54),
				u32le(40),
				u32le(5184),
				u32le(h >>> 0),
				[1, 0, 24, 0]
			);
		expect(probeDimensions(ab(bmp(3456)))).toEqual({
			width: 5184,
			height: 3456,
			orientation: 1
		});
		expect(probeDimensions(ab(bmp(-3456)))).toEqual({
			width: 5184,
			height: 3456,
			orientation: 1
		});
	});

	it('bails on the ancient BITMAPCOREHEADER', () => {
		const core = bytes('BM', u32le(100), u32le(0), u32le(26), u32le(12), new Uint8Array(12));
		expect(probeDimensions(ab(core))).toBeNull();
	});

	it('reads GIF logical screen dims', () => {
		const gif = bytes('GIF89a', u16le(1920), u16le(1280), new Uint8Array(8));
		expect(probeDimensions(ab(gif))).toEqual({ width: 1920, height: 1280, orientation: 1 });
	});

	it('returns null for garbage, tiny and truncated inputs', () => {
		expect(probeDimensions(new ArrayBuffer(4))).toBeNull();
		expect(probeDimensions(ab(bytes('NOTAFORMAT', new Uint8Array(20))))).toBeNull();
		expect(probeDimensions(ab(bytes(SOI, [0xff, 0xc0, 0x00, 0x03, 0x08])))).toBeNull();
		expect(probeDimensions(ab(bytes('RIFF', u32le(4), 'WEBP')))).toBeNull();
	});
});
