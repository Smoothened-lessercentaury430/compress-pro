/**
 * Read-only color-profile detection for the compression pipeline. Browser
 * decoding converts every source to sRGB and drops its ICC profile; the
 * WASM decoders (libheif, utif2) ignore profiles entirely, so the worker
 * matrix-converts the spaces it recognizes (see color-convert.ts). This
 * module only answers "what space is this?" — no conversion happens here.
 *
 * Never throws: any malformed/truncated container reads as "no profile".
 */

import { TiffReader } from './exif-parse';

function bytesMatch(arr: Uint8Array, offset: number, ascii: string): boolean {
	for (let k = 0; k < ascii.length; k++) {
		if (arr[offset + k] !== ascii.charCodeAt(k)) return false;
	}
	return true;
}

function fourcc(b: Uint8Array, at: number): string {
	return String.fromCharCode(b[at], b[at + 1], b[at + 2], b[at + 3]);
}

const LATIN1 = new TextDecoder('latin1');

// ------------------------------------------------------------ ICC desc name

/**
 * Display name from an ICC profile's `desc` tag — v2 `desc`
 * (textDescriptionType, ASCII) or v4 `mluc` (first record, UTF-16BE).
 */
export function iccDescription(profile: Uint8Array): string | null {
	if (profile.length < 132) return null;
	const view = new DataView(profile.buffer, profile.byteOffset, profile.byteLength);
	const tagCount = view.getUint32(128, false);
	if (tagCount === 0 || tagCount > 256) return null;

	for (let i = 0; i < tagCount; i++) {
		const at = 132 + i * 12;
		if (at + 12 > profile.length) return null;
		if (fourcc(profile, at) !== 'desc') continue;
		const offset = view.getUint32(at + 4, false);
		const size = view.getUint32(at + 8, false);
		if (size < 12 || offset + size > profile.length) return null;

		const type = fourcc(profile, offset);
		if (type === 'desc') {
			// sig(4) reserved(4) asciiCount(4) ascii… (count includes the NUL)
			const count = view.getUint32(offset + 8, false);
			if (count === 0 || offset + 12 + count > profile.length) return null;
			return LATIN1.decode(profile.subarray(offset + 12, offset + 12 + count)).replace(/\0+$/, '');
		}
		if (type === 'mluc') {
			// sig(4) reserved(4) recordCount(4) recordSize(4) then per record:
			// lang(2) country(2) length(4) offset(4); strings UTF-16BE, offsets
			// relative to the tag start.
			const recordCount = view.getUint32(offset + 8, false);
			if (recordCount === 0 || offset + 28 > profile.length) return null;
			const length = view.getUint32(offset + 20, false);
			const strOffset = view.getUint32(offset + 24, false);
			if (length === 0 || offset + strOffset + length > profile.length) return null;
			let s = '';
			for (let j = 0; j + 1 < length; j += 2) {
				s += String.fromCharCode(view.getUint16(offset + strOffset + j, false));
			}
			return s.replace(/\0+$/, '');
		}
		return null;
	}
	return null;
}

/** Wide-gamut profiles only — sRGB/CMYK/anything else must stay silent. */
export function classifyWideGamut(desc: string): string | null {
	const d = desc.toLowerCase();
	if (/dci[-\s]?p3/.test(d)) return 'DCI-P3';
	if (/display\s?p3|sp3c/.test(d)) return 'Display P3';
	if (/adobe\s?rgb/.test(d)) return 'Adobe RGB';
	if (/prophoto/.test(d)) return 'ProPhoto RGB';
	if (/rec\.?\s?2020|bt\.?\s?2020/.test(d)) return 'Rec. 2020';
	if (/wide\s?gamut/.test(d)) return 'Wide Gamut RGB';
	return null;
}

// -------------------------------------------------- per-container extractors

function jpegIccProfile(b: Uint8Array): Uint8Array | null {
	const parts: { seq: number; data: Uint8Array }[] = [];
	let i = 2;
	while (i + 4 <= b.length) {
		if (b[i] === 0xff && b[i + 1] === 0xff) {
			i++;
			continue;
		}
		if (b[i] !== 0xff) return null;
		const marker = b[i + 1];
		if (marker === 0xda) break; // SOS — no APP segments beyond this
		const length = (b[i + 2] << 8) | b[i + 3];
		if (length < 2 || i + 2 + length > b.length) return null;
		const payload = i + 4;
		// 'ICC_PROFILE\0' + seq byte + count byte, then this part's data.
		if (marker === 0xe2 && bytesMatch(b, payload, 'ICC_PROFILE\0')) {
			parts.push({ seq: b[payload + 12], data: b.subarray(payload + 14, i + 2 + length) });
		}
		i += 2 + length;
	}
	if (!parts.length) return null;
	parts.sort((x, y) => x.seq - y.seq);
	const total = parts.reduce((sum, p) => sum + p.data.length, 0);
	const out = new Uint8Array(total);
	let at = 0;
	for (const p of parts) {
		out.set(p.data, at);
		at += p.data.length;
	}
	return out;
}

async function inflate(data: Uint8Array): Promise<Uint8Array> {
	const stream = new Blob([data as BlobPart])
		.stream()
		.pipeThrough(new DecompressionStream('deflate'));
	return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function pngIccProfile(b: Uint8Array): Promise<Uint8Array | null> {
	let i = 8;
	while (i + 8 <= b.length) {
		const length = (b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3];
		if (length < 0 || i + 12 + length > b.length) return null;
		const type = fourcc(b, i + 4);
		if (type === 'iCCP') {
			// profile name\0 + compression method (0 = deflate) + deflate data
			const payload = b.subarray(i + 8, i + 8 + length);
			const nul = payload.indexOf(0);
			if (nul < 0 || nul + 2 > payload.length || payload[nul + 1] !== 0) return null;
			return inflate(payload.subarray(nul + 2));
		}
		if (type === 'IDAT' || type === 'IEND') return null; // iCCP must precede IDAT
		i += 12 + length;
	}
	return null;
}

function webpIccProfile(b: Uint8Array): Uint8Array | null {
	let i = 12;
	while (i + 8 <= b.length) {
		const size = b[i + 4] | (b[i + 5] << 8) | (b[i + 6] << 16) | (b[i + 7] << 24);
		if (size < 0 || i + 8 + size > b.length) return null;
		if (fourcc(b, i) === 'ICCP') return b.subarray(i + 8, i + 8 + size);
		i += 8 + size + (size & 1);
	}
	return null;
}

function isTiffMagic(b: Uint8Array): boolean {
	return (
		b.length >= 4 &&
		((b[0] === 0x49 && b[1] === 0x49 && b[2] === 0x2a && b[3] === 0) || // 'II*\0'
			(b[0] === 0x4d && b[1] === 0x4d && b[2] === 0 && b[3] === 0x2a)) // 'MM\0*'
	);
}

/** TIFF stores an ICC profile in IFD0 tag 34675 (InterColorProfile). */
function tiffIccProfile(b: Uint8Array): Uint8Array | null {
	try {
		const reader = new TiffReader(b);
		const entry = reader.readIfd(reader.ifd0Offset()).get(0x8773);
		return entry ? b.subarray(entry.valueOffset, entry.valueOffset + entry.count) : null;
	} catch {
		return null;
	}
}

// ISOBMFF (HEIC/AVIF): find the colr box under meta/iprp/ipco.
const NCLX_PRIMARIES: Record<number, string> = {
	9: 'Rec. 2020',
	11: 'DCI-P3',
	12: 'Display P3'
};

type ColrBox = { icc?: Uint8Array; nclxName?: string | null; transfer?: number };

function isobmffColr(b: Uint8Array, start: number, end: number, depth = 0): ColrBox | null {
	if (depth > 8) return null;
	let at = start;
	for (let guard = 0; guard < 512 && at + 8 <= end; guard++) {
		const view = new DataView(b.buffer, b.byteOffset);
		let size = view.getUint32(at, false);
		let body = at + 8;
		if (size === 1) {
			// 64-bit largesize — bail on anything a Uint8Array can't index anyway.
			if (at + 16 > end || view.getUint32(at + 8, false) !== 0) return null;
			size = view.getUint32(at + 12, false);
			body = at + 16;
		} else if (size === 0) {
			size = end - at; // box extends to the end
		}
		if (size < 8 || at + size > end) return null;
		const type = fourcc(b, at + 4);

		if (type === 'colr') {
			const colourType = fourcc(b, body);
			if (colourType === 'nclx') {
				if (body + 6 > end) return null;
				const primaries = view.getUint16(body + 4, false);
				const found: ColrBox = { nclxName: NCLX_PRIMARIES[primaries] ?? null };
				// transfer_characteristics decides convertibility (PQ/HLG = HDR).
				if (body + 8 <= end) found.transfer = view.getUint16(body + 6, false);
				return found;
			}
			if (colourType === 'prof' || colourType === 'rICC') {
				return { icc: b.subarray(body + 4, at + size) };
			}
			return null;
		}
		// Containers worth descending into ('meta' is a FullBox: +4 bytes).
		if (type === 'meta') {
			const found = isobmffColr(b, body + 4, at + size, depth + 1);
			if (found) return found;
		} else if (type === 'iprp' || type === 'ipco') {
			const found = isobmffColr(b, body, at + size, depth + 1);
			if (found) return found;
		}
		at += size;
	}
	return null;
}

// ------------------------------------------------------------------- public

/** Machine ids for the display names classifyWideGamut can return. */
export type WideGamutSpace =
	'display-p3' | 'dci-p3' | 'adobe-rgb' | 'prophoto' | 'rec2020' | 'wide-other';

const NAME_TO_SPACE: Record<string, WideGamutSpace> = {
	'DCI-P3': 'dci-p3',
	'Display P3': 'display-p3',
	'Adobe RGB': 'adobe-rgb',
	'ProPhoto RGB': 'prophoto',
	'Rec. 2020': 'rec2020',
	'Wide Gamut RGB': 'wide-other'
};

export interface ColorSpaceInfo {
	/** Display name for the UI note ("Display P3"). */
	name: string;
	space: WideGamutSpace;
	/** HEIF nclx transfer_characteristics, when the container carried one. */
	transfer?: number;
}

/**
 * Sniffs `bytes` for a color profile and classifies it. Returns null for
 * sRGB/untagged/unknown sources — those need no note and no conversion.
 */
export async function detectColorSpace(bytes: ArrayBuffer): Promise<ColorSpaceInfo | null> {
	try {
		const b = new Uint8Array(bytes);
		if (b.length < 16) return null;

		let icc: Uint8Array | null = null;
		let transfer: number | undefined;
		if (b[0] === 0xff && b[1] === 0xd8) {
			icc = jpegIccProfile(b);
		} else if (b[0] === 0x89 && bytesMatch(b, 1, 'PNG')) {
			icc = await pngIccProfile(b);
		} else if (bytesMatch(b, 0, 'RIFF') && bytesMatch(b, 8, 'WEBP')) {
			icc = webpIccProfile(b);
		} else if (bytesMatch(b, 4, 'ftyp')) {
			const colr = isobmffColr(b, 0, b.length);
			if (!colr) return null;
			transfer = colr.transfer;
			if (colr.nclxName !== undefined) {
				return colr.nclxName
					? { name: colr.nclxName, space: NAME_TO_SPACE[colr.nclxName], transfer }
					: null;
			}
			icc = colr.icc ?? null;
		} else if (isTiffMagic(b)) {
			icc = tiffIccProfile(b);
		}

		if (!icc) return null;
		const desc = iccDescription(icc);
		const name = desc ? classifyWideGamut(desc) : null;
		return name ? { name, space: NAME_TO_SPACE[name], transfer } : null;
	} catch {
		return null;
	}
}

/**
 * Sniffs `bytes` for a color profile and returns the wide-gamut display name
 * ("Display P3", "Adobe RGB", …) or null for sRGB/untagged/unknown sources.
 */
export async function detectWideGamut(bytes: ArrayBuffer): Promise<string | null> {
	return (await detectColorSpace(bytes))?.name ?? null;
}

/**
 * True when this container is decoded by the WASM decoders (libheif for
 * HEIC/HEIF, utif2 for TIFF), which ignore embedded profiles — as opposed
 * to createImageBitmap formats, where the browser color-manages everything.
 * AVIF is ISOBMFF too but decodes natively in the browser.
 */
export function isWasmDecodedSource(bytes: ArrayBuffer): boolean {
	const b = new Uint8Array(bytes, 0, Math.min(16, bytes.byteLength));
	if (isTiffMagic(b)) return true;
	if (b.length >= 12 && bytesMatch(b, 4, 'ftyp')) {
		const brand = fourcc(b, 8);
		return brand !== 'avif' && brand !== 'avis';
	}
	return false;
}
