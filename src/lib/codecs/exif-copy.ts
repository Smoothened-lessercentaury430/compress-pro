/**
 * EXIF carry-over for re-encoded images (the "Keep metadata" toggle) — the
 * counterpart of exif.ts, which strips. Extracts the raw TIFF payload from
 * the SOURCE container (JPEG APP1, PNG eXIf, WebP EXIF chunk, HEIF Exif
 * item), drops the IFD1 thumbnail (10-60 KB of stale preview), neutralizes
 * Orientation (pixels leave the decoder upright) and the ExifIFD ColorSpace
 * tag (pixels are sRGB after decode/conversion), then splices the result
 * into the freshly ENCODED JPEG/PNG/WebP.
 *
 * ICC is deliberately never copied: the pipeline outputs sRGB pixels and an
 * untagged file already means sRGB everywhere.
 *
 * Never throws: any parse doubt returns null and the caller simply ships
 * the output without metadata.
 */

import { crc32 } from './exif';
import { TiffReader, TYPE_SIZES, type Entry } from './exif-parse';

const EXIF_PREFIX = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00]; // "Exif\0\0"
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function startsWith(bytes: Uint8Array, offset: number, prefix: number[] | string): boolean {
	if (typeof prefix === 'string') {
		for (let i = 0; i < prefix.length; i++) {
			if (bytes[offset + i] !== prefix.charCodeAt(i)) return false;
		}
		return true;
	}
	for (let i = 0; i < prefix.length; i++) {
		if (bytes[offset + i] !== prefix[i]) return false;
	}
	return true;
}

function fourcc(b: Uint8Array, at: number): string {
	return String.fromCharCode(b[at], b[at + 1], b[at + 2], b[at + 3]);
}

function concat(parts: Uint8Array[]): Uint8Array {
	const total = parts.reduce((sum, p) => sum + p.length, 0);
	const out = new Uint8Array(total);
	let at = 0;
	for (const p of parts) {
		out.set(p, at);
		at += p.length;
	}
	return out;
}

// -------------------------------------------------------------- extraction

function jpegExifPayload(b: Uint8Array): Uint8Array | null {
	let i = 2;
	while (i + 4 <= b.length) {
		if (b[i] === 0xff && b[i + 1] === 0xff) {
			i++;
			continue;
		}
		if (b[i] !== 0xff) return null;
		const marker = b[i + 1];
		if (marker === 0xda) return null; // SOS — no APP segments beyond
		const length = (b[i + 2] << 8) | b[i + 3];
		if (length < 2 || i + 2 + length > b.length) return null;
		if (marker === 0xe1 && startsWith(b, i + 4, EXIF_PREFIX)) {
			return b.subarray(i + 4 + 6, i + 2 + length);
		}
		i += 2 + length;
	}
	return null;
}

function pngExifPayload(b: Uint8Array): Uint8Array | null {
	let i = 8;
	while (i + 8 <= b.length) {
		const length = ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
		if (i + 12 + length > b.length) return null;
		const type = fourcc(b, i + 4);
		if (type === 'eXIf') return b.subarray(i + 8, i + 8 + length);
		if (type === 'IEND') return null;
		i += 12 + length;
	}
	return null;
}

function webpExifPayload(b: Uint8Array): Uint8Array | null {
	let i = 12;
	while (i + 8 <= b.length) {
		const size = (b[i + 4] | (b[i + 5] << 8) | (b[i + 6] << 16) | (b[i + 7] << 24)) >>> 0;
		if (i + 8 + size > b.length) return null;
		if (fourcc(b, i) === 'EXIF') {
			let payload = b.subarray(i + 8, i + 8 + size);
			// Some encoders include the JPEG-style prefix inside the chunk.
			if (payload.length > 6 && startsWith(payload, 0, EXIF_PREFIX)) payload = payload.subarray(6);
			return payload;
		}
		i += 8 + size + (size & 1);
	}
	return null;
}

// HEIF: meta → iinf/infe (find the 'Exif' item id) + iloc (find its extents)
// + idat (construction_method 1). Minimal, bounds-checked, throw → null.

interface HeifBoxes {
	iinf?: { start: number; end: number };
	iloc?: { start: number; end: number };
	idat?: { start: number; end: number };
}

function findMetaChildren(b: Uint8Array, start: number, end: number, depth = 0): HeifBoxes | null {
	if (depth > 4) return null;
	const view = new DataView(b.buffer, b.byteOffset);
	let at = start;
	for (let guard = 0; guard < 512 && at + 8 <= end; guard++) {
		let size = view.getUint32(at, false);
		let body = at + 8;
		if (size === 1) {
			if (at + 16 > end || view.getUint32(at + 8, false) !== 0) return null;
			size = view.getUint32(at + 12, false);
			body = at + 16;
		} else if (size === 0) {
			size = end - at;
		}
		if (size < 8 || at + size > end) return null;
		const type = fourcc(b, at + 4);
		if (type === 'meta') {
			// FullBox: skip version+flags, then collect the children we need.
			const boxes: HeifBoxes = {};
			let c = body + 4;
			for (let g = 0; g < 512 && c + 8 <= at + size; g++) {
				const csize = view.getUint32(c, false);
				if (csize < 8 || c + csize > at + size) break;
				const ctype = fourcc(b, c + 4);
				if (ctype === 'iinf') boxes.iinf = { start: c + 8, end: c + csize };
				if (ctype === 'iloc') boxes.iloc = { start: c + 8, end: c + csize };
				if (ctype === 'idat') boxes.idat = { start: c + 8, end: c + csize };
				c += csize;
			}
			return boxes;
		}
		at += size;
	}
	return null;
}

/** Item id of the 'Exif' infe entry, or null. */
function exifItemId(b: Uint8Array, iinf: { start: number; end: number }): number | null {
	const view = new DataView(b.buffer, b.byteOffset);
	const version = b[iinf.start];
	let at = iinf.start + 4;
	const count = version === 0 ? view.getUint16(at, false) : view.getUint32(at, false);
	at += version === 0 ? 2 : 4;
	for (let i = 0; i < count && at + 8 <= iinf.end; i++) {
		const size = view.getUint32(at, false);
		if (size < 8 || at + size > iinf.end) return null;
		if (fourcc(b, at + 4) === 'infe') {
			const v = b[at + 8];
			const body = at + 12; // after FullBox version+flags
			let id: number;
			let typeAt: number;
			if (v === 2) {
				id = view.getUint16(body, false);
				typeAt = body + 4;
			} else if (v === 3) {
				id = view.getUint32(body, false);
				typeAt = body + 6;
			} else {
				at += size;
				continue;
			}
			if (typeAt + 4 <= at + size && fourcc(b, typeAt) === 'Exif') return id;
		}
		at += size;
	}
	return null;
}

function readSized(view: DataView, at: number, size: number): number {
	if (size === 0) return 0;
	if (size === 4) return view.getUint32(at, false);
	if (size === 8) {
		if (view.getUint32(at, false) !== 0) throw new Error('64-bit offset');
		return view.getUint32(at + 4, false);
	}
	throw new Error('bad size');
}

/** Concatenated extent bytes for `itemId`, resolving construction methods 0 (file) and 1 (idat). */
function ilocItemBytes(
	b: Uint8Array,
	iloc: { start: number; end: number },
	idat: { start: number; end: number } | undefined,
	itemId: number
): Uint8Array | null {
	const view = new DataView(b.buffer, b.byteOffset);
	const version = b[iloc.start];
	if (version > 2) return null;
	let at = iloc.start + 4;
	const offsetSize = b[at] >> 4;
	const lengthSize = b[at] & 0xf;
	const baseOffsetSize = b[at + 1] >> 4;
	const indexSize = version >= 1 ? b[at + 1] & 0xf : 0;
	at += 2;
	const count = version < 2 ? view.getUint16(at, false) : view.getUint32(at, false);
	at += version < 2 ? 2 : 4;

	for (let i = 0; i < count; i++) {
		const id = version < 2 ? view.getUint16(at, false) : view.getUint32(at, false);
		at += version < 2 ? 2 : 4;
		let method = 0;
		if (version >= 1) {
			method = view.getUint16(at, false) & 0xf;
			at += 2;
		}
		at += 2; // data_reference_index
		const baseOffset = readSized(view, at, baseOffsetSize);
		at += baseOffsetSize;
		const extentCount = view.getUint16(at, false);
		at += 2;

		if (id !== itemId) {
			at += extentCount * (indexSize + offsetSize + lengthSize);
			continue;
		}
		if (method > 1) return null; // item-offset construction: not seen in the wild
		const parts: Uint8Array[] = [];
		for (let e = 0; e < extentCount; e++) {
			at += indexSize;
			const offset = readSized(view, at, offsetSize);
			at += offsetSize;
			const length = readSized(view, at, lengthSize);
			at += lengthSize;
			const from = method === 1 ? (idat?.start ?? -1) + baseOffset + offset : baseOffset + offset;
			if (from < 0 || from + length > (method === 1 ? (idat?.end ?? 0) : b.length)) return null;
			parts.push(b.subarray(from, from + length));
		}
		return concat(parts);
	}
	return null;
}

function heifExifPayload(b: Uint8Array): Uint8Array | null {
	const boxes = findMetaChildren(b, 0, b.length);
	if (!boxes?.iinf || !boxes.iloc) return null;
	const id = exifItemId(b, boxes.iinf);
	if (id === null) return null;
	const item = ilocItemBytes(b, boxes.iloc, boxes.idat, id);
	if (!item || item.length < 8) return null;
	// ExifDataBlock: u32 BE offset to the TIFF header within the payload.
	const offset = ((item[0] << 24) | (item[1] << 16) | (item[2] << 8) | item[3]) >>> 0;
	if (4 + offset >= item.length) return null;
	return item.subarray(4 + offset);
}

// ----------------------------------------------- thumbnail drop + neutralize

/** Max referenced byte across an IFD's table and entry values. */
function ifdExtent(reader: TiffReader, offset: number): number {
	const entries = reader.readIfd(offset);
	let max = offset + 2 + entries.size * 12 + 4;
	for (const entry of entries.values()) {
		const size = (TYPE_SIZES[entry.type] ?? 1) * entry.count;
		max = Math.max(max, entry.valueOffset + size);
	}
	return max;
}

/**
 * Cuts the IFD1 thumbnail (stale 10-60 KB preview) when the layout allows:
 * IFD0's next-IFD pointer is zeroed, and the buffer is truncated at IFD1's
 * start if nothing IFD0 references lives beyond it. Runs on a copy.
 */
function dropThumbnail(tiff: Uint8Array): Uint8Array {
	try {
		const reader = new TiffReader(tiff);
		const ifd0Offset = reader.ifd0Offset();
		const ifd0 = reader.readIfd(ifd0Offset);
		const nextIfdAt = ifd0Offset + 2 + ifd0.size * 12;
		const ifd1Offset = reader.u32(nextIfdAt);
		if (ifd1Offset === 0) return tiff;

		const out = new Uint8Array(tiff);
		new DataView(out.buffer).setUint32(nextIfdAt, 0, reader.littleEndian);

		// Safe to truncate only if every primary structure sits before IFD1.
		let extent = ifdExtent(reader, ifd0Offset);
		for (const pointerTag of [0x8769, 0x8825]) {
			const pointer = ifd0.get(pointerTag);
			if (!pointer) continue;
			const subOffset = reader.u32(pointer.valueOffset);
			extent = Math.max(extent, ifdExtent(reader, subOffset));
			if (pointerTag === 0x8769) {
				const interop = reader.readIfd(subOffset).get(0xa005);
				if (interop) extent = Math.max(extent, ifdExtent(reader, reader.u32(interop.valueOffset)));
			}
		}
		return extent <= ifd1Offset ? out.subarray(0, ifd1Offset) : out;
	} catch {
		return tiff;
	}
}

/** Sets a SHORT tag to `value` in place when present with count 1. */
function patchShortTag(
	out: Uint8Array,
	reader: TiffReader,
	entry: Entry | undefined,
	value: number
): void {
	if (!entry || entry.type !== 3 || entry.count !== 1) return;
	new DataView(out.buffer, out.byteOffset).setUint16(entry.valueOffset, value, reader.littleEndian);
}

/**
 * Re-encode hygiene on a copy: Orientation → 1 (decoded pixels are upright;
 * shipping the original tag would double-rotate) and ExifIFD ColorSpace →
 * 1/sRGB (pixels are sRGB after decode/conversion).
 */
function neutralizeForReencode(tiff: Uint8Array): Uint8Array | null {
	try {
		const out = new Uint8Array(tiff);
		const reader = new TiffReader(out);
		const ifd0 = reader.readIfd(reader.ifd0Offset());
		patchShortTag(out, reader, ifd0.get(0x0112), 1);
		const exifPointer = ifd0.get(0x8769);
		if (exifPointer) {
			const exifIfd = reader.readIfd(reader.u32(exifPointer.valueOffset));
			patchShortTag(out, reader, exifIfd.get(0xa001), 1);
		}
		return out;
	} catch {
		return null; // unparseable payload must not ship with a live rotation tag
	}
}

// ------------------------------------------------------------------ public

/**
 * The full source-side pipeline: sniff container → extract raw TIFF →
 * drop thumbnail → neutralize. Null = nothing usable (caller skips quietly).
 */
export function exifPayloadForReencode(bytes: ArrayBuffer): Uint8Array | null {
	try {
		const b = new Uint8Array(bytes);
		if (b.length < 16) return null;
		let payload: Uint8Array | null = null;
		if (b[0] === 0xff && b[1] === 0xd8) payload = jpegExifPayload(b);
		else if (startsWith(b, 0, PNG_SIGNATURE)) payload = pngExifPayload(b);
		else if (startsWith(b, 0, 'RIFF') && startsWith(b, 8, 'WEBP')) payload = webpExifPayload(b);
		else if (startsWith(b, 4, 'ftyp')) payload = heifExifPayload(b);
		// TIFF sources: the file IS a TIFF — extracting "the EXIF" would mean
		// rebuilding a metadata-only TIFF with offset rewriting. Out of scope.
		if (!payload || payload.length < 8) return null;
		return neutralizeForReencode(dropThumbnail(payload));
	} catch {
		return null;
	}
}

// ---------------------------------------------------------------- splicing

function spliceJpegExif(encoded: Uint8Array, tiff: Uint8Array): Uint8Array | null {
	const payloadLength = 6 + tiff.length;
	if (payloadLength + 2 > 0xffff) return null; // APP1 hard limit
	if (encoded[0] !== 0xff || encoded[1] !== 0xd8) return null;
	// Insert after any leading APP0 (JFIF) block, per the EXIF-in-JFIF convention.
	let i = 2;
	while (i + 4 <= encoded.length) {
		if (encoded[i] === 0xff && encoded[i + 1] === 0xff) {
			i++;
			continue;
		}
		if (encoded[i] !== 0xff || encoded[i + 1] !== 0xe0) break;
		const length = (encoded[i + 2] << 8) | encoded[i + 3];
		if (length < 2 || i + 2 + length > encoded.length) return null;
		i += 2 + length;
	}
	const segment = new Uint8Array(4 + payloadLength);
	segment[0] = 0xff;
	segment[1] = 0xe1;
	segment[2] = (payloadLength + 2) >> 8;
	segment[3] = (payloadLength + 2) & 0xff;
	segment.set(EXIF_PREFIX, 4);
	segment.set(tiff, 10);
	return concat([encoded.subarray(0, i), segment, encoded.subarray(i)]);
}

function splicePngExif(encoded: Uint8Array, tiff: Uint8Array): Uint8Array | null {
	if (!startsWith(encoded, 0, PNG_SIGNATURE) || !startsWith(encoded, 12, 'IHDR')) return null;
	const ihdrLength =
		((encoded[8] << 24) | (encoded[9] << 16) | (encoded[10] << 8) | encoded[11]) >>> 0;
	const insertAt = 8 + 12 + ihdrLength;
	if (insertAt > encoded.length) return null;
	const chunk = new Uint8Array(12 + tiff.length);
	const view = new DataView(chunk.buffer);
	view.setUint32(0, tiff.length, false);
	chunk.set([0x65, 0x58, 0x49, 0x66], 4); // "eXIf"
	chunk.set(tiff, 8);
	view.setUint32(8 + tiff.length, crc32(chunk.subarray(4, 8 + tiff.length)), false);
	return concat([encoded.subarray(0, insertAt), chunk, encoded.subarray(insertAt)]);
}

const VP8X_ALPHA = 0x10;
const VP8X_EXIF = 0x08;

function buildWebpExifChunk(tiff: Uint8Array): Uint8Array {
	const chunk = new Uint8Array(8 + tiff.length + (tiff.length & 1));
	chunk.set([0x45, 0x58, 0x49, 0x46], 0); // "EXIF"
	new DataView(chunk.buffer).setUint32(4, tiff.length, true);
	chunk.set(tiff, 8);
	return chunk;
}

/** Canvas dims + alpha bit straight from the bitstream (no side channel). */
function webpStreamInfo(
	encoded: Uint8Array
): { width: number; height: number; alpha: boolean } | null {
	const kind = fourcc(encoded, 12);
	if (kind === 'VP8 ') {
		const p = 20;
		if (encoded.length < p + 10) return null;
		if (encoded[p + 3] !== 0x9d || encoded[p + 4] !== 0x01 || encoded[p + 5] !== 0x2a) return null;
		const width = (encoded[p + 6] | (encoded[p + 7] << 8)) & 0x3fff;
		const height = (encoded[p + 8] | (encoded[p + 9] << 8)) & 0x3fff;
		return width && height ? { width, height, alpha: false } : null;
	}
	if (kind === 'VP8L') {
		if (encoded.length < 25 || encoded[20] !== 0x2f) return null;
		const bits =
			(encoded[21] | (encoded[22] << 8) | (encoded[23] << 16) | (encoded[24] << 24)) >>> 0;
		return {
			width: (bits & 0x3fff) + 1,
			height: ((bits >> 14) & 0x3fff) + 1,
			alpha: !!(bits & (1 << 28))
		};
	}
	return null;
}

function spliceWebpExif(encoded: Uint8Array, tiff: Uint8Array): Uint8Array | null {
	if (!startsWith(encoded, 0, 'RIFF') || !startsWith(encoded, 8, 'WEBP')) return null;
	const exifChunk = buildWebpExifChunk(tiff);

	if (fourcc(encoded, 12) === 'VP8X') {
		// Extended file already: set the flag, append the chunk, fix RIFF size.
		const out = concat([encoded, exifChunk]);
		out[20] |= VP8X_EXIF;
		new DataView(out.buffer).setUint32(4, out.length - 8, true);
		return out;
	}

	// Bare VP8/VP8L (every static @jsquash output): build the VP8X header.
	const info = webpStreamInfo(encoded);
	if (!info) return null;
	const vp8x = new Uint8Array(18);
	vp8x.set([0x56, 0x50, 0x38, 0x58], 0); // "VP8X"
	new DataView(vp8x.buffer).setUint32(4, 10, true);
	vp8x[8] = VP8X_EXIF | (info.alpha ? VP8X_ALPHA : 0);
	const w = info.width - 1;
	const h = info.height - 1;
	vp8x.set([w & 0xff, (w >> 8) & 0xff, (w >> 16) & 0xff], 12);
	vp8x.set([h & 0xff, (h >> 8) & 0xff, (h >> 16) & 0xff], 15);

	const out = concat([encoded.subarray(0, 12), vp8x, encoded.subarray(12), exifChunk]);
	new DataView(out.buffer).setUint32(4, out.length - 8, true);
	return out;
}

/**
 * Splices a prepared TIFF payload into a freshly encoded image. Null on any
 * structural surprise — the caller ships the metadata-less output.
 */
export function spliceExifIntoImage(
	encoded: Uint8Array,
	format: 'jpg' | 'png' | 'webp',
	tiff: Uint8Array
): Uint8Array | null {
	try {
		if (format === 'jpg') return spliceJpegExif(encoded, tiff);
		if (format === 'png') return splicePngExif(encoded, tiff);
		return spliceWebpExif(encoded, tiff);
	} catch {
		return null;
	}
}
