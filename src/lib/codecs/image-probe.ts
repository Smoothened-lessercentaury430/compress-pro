/**
 * Header-only dimension probe for the createImageBitmap formats. Lets the
 * image worker ask for a decode-time downscale (resizeWidth/resizeHeight)
 * on multi-megapixel sources without paying a full-resolution decode first.
 *
 * Returns raw stored dimensions plus the EXIF orientation (1 when absent) —
 * the caller swaps width/height for orientations 5-8. Any parse doubt
 * returns null and the caller simply takes the normal decode path.
 */

import { TiffReader } from './exif-parse';

export interface ProbedDimensions {
	width: number;
	height: number;
	/** EXIF orientation tag value; 1 = upright/absent. */
	orientation: number;
}

function ascii(b: Uint8Array, at: number, text: string): boolean {
	for (let k = 0; k < text.length; k++) {
		if (b[at + k] !== text.charCodeAt(k)) return false;
	}
	return true;
}

function u16be(b: Uint8Array, at: number): number {
	return (b[at] << 8) | b[at + 1];
}

function u16le(b: Uint8Array, at: number): number {
	return b[at] | (b[at + 1] << 8);
}

function u24le(b: Uint8Array, at: number): number {
	return b[at] | (b[at + 1] << 8) | (b[at + 2] << 16);
}

function u32be(b: Uint8Array, at: number): number {
	return ((b[at] << 24) | (b[at + 1] << 16) | (b[at + 2] << 8) | b[at + 3]) >>> 0;
}

function u32le(b: Uint8Array, at: number): number {
	return (b[at] | (b[at + 1] << 8) | (b[at + 2] << 16) | (b[at + 3] << 24)) >>> 0;
}

function orientationFromTiff(tiff: Uint8Array): number {
	try {
		const reader = new TiffReader(tiff);
		const entry = reader.readIfd(reader.ifd0Offset()).get(0x0112);
		const value = entry ? reader.ushort(entry) : 1;
		return value >= 1 && value <= 8 ? value : 1;
	} catch {
		return 1;
	}
}

/** SOF0-SOF15 minus DHT (C4), JPG (C8) and DAC (CC), which share the range. */
const SOF_MARKERS = new Set([
	0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf
]);

function probeJpeg(b: Uint8Array): ProbedDimensions | null {
	let width = 0;
	let height = 0;
	let orientation = 1;
	let sawExif = false;
	let i = 2;
	while (i + 4 <= b.length) {
		if (b[i] === 0xff && b[i + 1] === 0xff) {
			i++;
			continue;
		}
		if (b[i] !== 0xff) return null;
		const marker = b[i + 1];
		if (marker === 0xda) break; // SOS — entropy data from here on
		const length = u16be(b, i + 2);
		if (length < 2 || i + 2 + length > b.length) return null;
		const payload = i + 4;
		// Walking segments (not scanning bytes) inherently skips the SOF of any
		// embedded EXIF thumbnail — it lives INSIDE the APP1 payload.
		if (SOF_MARKERS.has(marker)) {
			if (length < 7) return null;
			height = u16be(b, payload + 1);
			width = u16be(b, payload + 3);
			// Keep walking: the EXIF APP1 usually precedes SOF, but not always.
		} else if (marker === 0xe1 && !sawExif && length > 8 && ascii(b, payload, 'Exif\0\0')) {
			sawExif = true;
			orientation = orientationFromTiff(b.subarray(payload + 6, i + 2 + length));
		}
		if (width && height && sawExif) break;
		i += 2 + length;
	}
	return width > 0 && height > 0 ? { width, height, orientation } : null;
}

function probePng(b: Uint8Array): ProbedDimensions | null {
	// Signature(8) + IHDR length(4) + 'IHDR'(4) — dims are the first 8 bytes.
	if (b.length < 33 || !ascii(b, 12, 'IHDR')) return null;
	const width = u32be(b, 16);
	const height = u32be(b, 20);
	if (!width || !height) return null;
	// Optional eXIf chunk (must precede IDAT to be cheap to find).
	let orientation = 1;
	let i = 8;
	while (i + 8 <= b.length) {
		const length = u32be(b, i);
		const type = String.fromCharCode(b[i + 4], b[i + 5], b[i + 6], b[i + 7]);
		if (i + 12 + length > b.length) break;
		if (type === 'eXIf') {
			orientation = orientationFromTiff(b.subarray(i + 8, i + 8 + length));
			break;
		}
		if (type === 'IDAT' || type === 'IEND') break;
		i += 12 + length;
	}
	return { width, height, orientation };
}

function probeWebp(b: Uint8Array): ProbedDimensions | null {
	if (b.length < 20) return null;
	const kind = String.fromCharCode(b[12], b[13], b[14], b[15]);
	if (kind === 'VP8X') {
		if (b.length < 30) return null;
		// flags(1) reserved(3) then canvas w-1 / h-1 as u24 LE.
		const width = u24le(b, 24) + 1;
		const height = u24le(b, 27) + 1;
		let orientation = 1;
		if (b[20] & 0x08) {
			// EXIF flag set — the chunk sits after the image data; walk to it.
			let i = 12;
			while (i + 8 <= b.length) {
				const size = u32le(b, i + 4);
				if (i + 8 + size > b.length) break;
				if (ascii(b, i, 'EXIF')) {
					let payload = b.subarray(i + 8, i + 8 + size);
					if (payload.length > 6 && ascii(payload, 0, 'Exif\0\0')) payload = payload.subarray(6);
					orientation = orientationFromTiff(payload);
					break;
				}
				i += 8 + size + (size & 1);
			}
		}
		return { width, height, orientation };
	}
	if (kind === 'VP8 ') {
		// Key frame: 3-byte frame tag, then start code 9D 01 2A, then dims.
		const p = 20;
		if (b.length < p + 10) return null;
		if (b[p + 3] !== 0x9d || b[p + 4] !== 0x01 || b[p + 5] !== 0x2a) return null;
		const width = u16le(b, p + 6) & 0x3fff;
		const height = u16le(b, p + 8) & 0x3fff;
		return width && height ? { width, height, orientation: 1 } : null;
	}
	if (kind === 'VP8L') {
		if (b.length < 25 || b[20] !== 0x2f) return null;
		const bits = u32le(b, 21);
		const width = (bits & 0x3fff) + 1;
		const height = ((bits >> 14) & 0x3fff) + 1;
		return { width, height, orientation: 1 };
	}
	return null;
}

function probeBmp(b: Uint8Array): ProbedDimensions | null {
	// BITMAPINFOHEADER or later (size ≥ 40); the ancient BITMAPCOREHEADER
	// stores u16 dims — bail and let the browser handle it.
	if (b.length < 26 || u32le(b, 14) < 40) return null;
	const width = u32le(b, 18) | 0;
	const rawHeight = u32le(b, 22) | 0;
	const height = Math.abs(rawHeight); // negative = top-down rows
	return width > 0 && height > 0 ? { width, height, orientation: 1 } : null;
}

function probeGif(b: Uint8Array): ProbedDimensions | null {
	const width = u16le(b, 6);
	const height = u16le(b, 8);
	return width && height ? { width, height, orientation: 1 } : null;
}

/**
 * Stored dimensions + EXIF orientation from the header, or null when the
 * format/file resists cheap parsing.
 */
export function probeDimensions(bytes: ArrayBuffer): ProbedDimensions | null {
	try {
		const b = new Uint8Array(bytes);
		if (b.length < 16) return null;
		if (b[0] === 0xff && b[1] === 0xd8) return probeJpeg(b);
		if (b[0] === 0x89 && ascii(b, 1, 'PNG')) return probePng(b);
		if (ascii(b, 0, 'RIFF') && ascii(b, 8, 'WEBP')) return probeWebp(b);
		if (ascii(b, 0, 'BM')) return probeBmp(b);
		if (ascii(b, 0, 'GIF8')) return probeGif(b);
		return null;
	} catch {
		return null;
	}
}
