// Minimal animated-WebP (RIFF/VP8X/ANIM/ANMF) muxer. Frames arrive as complete
// still .webp files (from @jsquash/webp); their inner bitstream chunks are
// spliced into ANMF chunks per the WebP Container Specification.

/** libwebp and the WebP container (VP8X 14-bit fields) cap at 16383 px per side. */
export const WEBP_MAX_DIMENSION = 16383;

export interface AnimatedFrame {
	/** A complete still .webp file. */
	still: Uint8Array;
	durationMs: number;
}

export interface MuxOptions {
	width: number;
	height: number;
	/** WebP ANIM semantics: 0 = infinite, else total number of plays. */
	loopCount: number;
	frames: AnimatedFrame[];
}

/**
 * Sniffs whether bytes are a GIF, an ANIMATED WebP (VP8X with the ANIM flag)
 * or an ANIMATED PNG (acTL chunk before IDAT). Returns the MIME type for
 * ImageDecoder, or null for anything else. GIF/WebP need only the header;
 * APNG needs a bounded chunk walk (acTL sits between IHDR and IDAT).
 */
export function sniffAnimatedInput(
	bytes: ArrayBuffer
): 'image/gif' | 'image/webp' | 'image/png' | null {
	const b = new Uint8Array(bytes, 0, Math.min(21, bytes.byteLength));
	if (b.length >= 4 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) {
		return 'image/gif'; // 'GIF8'
	}
	const isRiffWebp =
		b.length >= 21 &&
		b[0] === 0x52 &&
		b[1] === 0x49 &&
		b[2] === 0x46 &&
		b[3] === 0x46 && // 'RIFF'
		b[8] === 0x57 &&
		b[9] === 0x45 &&
		b[10] === 0x42 &&
		b[11] === 0x50; // 'WEBP'
	const isVp8x = isRiffWebp && b[12] === 0x56 && b[13] === 0x50 && b[14] === 0x38 && b[15] === 0x58;
	if (isVp8x && (b[20] & 0x02) !== 0) return 'image/webp'; // ANIM flag

	const all = new Uint8Array(bytes);
	if (
		all.length > 16 &&
		all[0] === 0x89 &&
		all[1] === 0x50 &&
		all[2] === 0x4e &&
		all[3] === 0x47 // '\x89PNG'
	) {
		let at = 8;
		for (let guard = 0; guard < 64 && at + 8 <= all.length; guard++) {
			const length = (all[at] << 24) | (all[at + 1] << 16) | (all[at + 2] << 8) | all[at + 3];
			const type = String.fromCharCode(all[at + 4], all[at + 5], all[at + 6], all[at + 7]);
			if (type === 'acTL') return 'image/png';
			if (type === 'IDAT' || type === 'IEND') break;
			if (length < 0) break;
			at += 12 + length;
		}
	}
	return null;
}

interface FrameData {
	data: Uint8Array;
	hasAlpha: boolean;
}

/**
 * Extracts the ANMF payload from a still .webp: the ALPH (optional) and
 * VP8/VP8L bitstream chunks, verbatim with their headers and pad bytes;
 * RIFF/WEBP/VP8X wrappers and metadata chunks are dropped.
 */
function extractFrameData(still: Uint8Array): FrameData {
	const fourcc = (o: number) =>
		String.fromCharCode(still[o], still[o + 1], still[o + 2], still[o + 3]);
	if (still.length < 12 || fourcc(0) !== 'RIFF' || fourcc(8) !== 'WEBP') {
		throw new Error('Frame is not a valid WebP file');
	}

	const kept: Uint8Array[] = [];
	let hasAlpha = false;
	let offset = 12;
	while (offset + 8 <= still.length) {
		const id = fourcc(offset);
		const size =
			still[offset + 4] |
			(still[offset + 5] << 8) |
			(still[offset + 6] << 16) |
			(still[offset + 7] << 24);
		const paddedEnd = offset + 8 + size + (size & 1);
		if (id === 'ALPH' || id === 'VP8 ' || id === 'VP8L') {
			kept.push(still.subarray(offset, Math.min(paddedEnd, still.length)));
			if (id === 'ALPH') hasAlpha = true;
			// VP8L stores an alpha_is_used bit after the 0x2f signature byte.
			if (id === 'VP8L' && size >= 5 && (still[offset + 8 + 4] & 0x10) !== 0) hasAlpha = true;
		}
		offset = paddedEnd;
	}
	if (!kept.length) throw new Error('No VP8/VP8L bitstream found in frame');

	const total = kept.reduce((sum, part) => sum + part.length, 0);
	const data = new Uint8Array(total);
	let cursor = 0;
	for (const part of kept) {
		data.set(part, cursor);
		cursor += part.length;
	}
	return { data, hasAlpha };
}

export function muxAnimatedWebp({ width, height, loopCount, frames }: MuxOptions): Uint8Array {
	if (!frames.length) throw new Error('No frames to mux');
	if (width < 1 || height < 1 || width > WEBP_MAX_DIMENSION || height > WEBP_MAX_DIMENSION) {
		throw new Error(`Canvas ${width}x${height} exceeds WebP limits`);
	}

	const frameData = frames.map((frame) => extractFrameData(frame.still));
	const anyAlpha = frameData.some((f) => f.hasAlpha);

	const VP8X_TOTAL = 8 + 10;
	const ANIM_TOTAL = 8 + 6;
	const anmfTotals = frameData.map((f) => 8 + 16 + f.data.length); // payloads are even
	const fileLength = 12 + VP8X_TOTAL + ANIM_TOTAL + anmfTotals.reduce((a, b) => a + b, 0);

	const out = new Uint8Array(fileLength);
	let o = 0;
	const ascii = (s: string) => {
		for (let i = 0; i < s.length; i++) out[o++] = s.charCodeAt(i);
	};
	const u32 = (v: number) => {
		out[o++] = v & 0xff;
		out[o++] = (v >>> 8) & 0xff;
		out[o++] = (v >>> 16) & 0xff;
		out[o++] = (v >>> 24) & 0xff;
	};
	const u24 = (v: number) => {
		out[o++] = v & 0xff;
		out[o++] = (v >>> 8) & 0xff;
		out[o++] = (v >>> 16) & 0xff;
	};
	const u16 = (v: number) => {
		out[o++] = v & 0xff;
		out[o++] = (v >>> 8) & 0xff;
	};

	ascii('RIFF');
	u32(fileLength - 8);
	ascii('WEBP');

	ascii('VP8X');
	u32(10);
	u32((anyAlpha ? 0x10 : 0) | 0x02); // flags byte (ANIM, ALPHA); reserved bytes 0
	u24(width - 1);
	u24(height - 1);

	ascii('ANIM');
	u32(6);
	u32(0x00000000); // background color: transparent black
	u16(Math.max(0, Math.min(0xffff, loopCount)));

	for (let i = 0; i < frames.length; i++) {
		const data = frameData[i].data;
		ascii('ANMF');
		u32(16 + data.length);
		u24(0); // frame X / 2
		u24(0); // frame Y / 2
		u24(width - 1);
		u24(height - 1);
		u24(Math.max(0, Math.min(0xffffff, Math.round(frames[i].durationMs))));
		out[o++] = 0x02; // do NOT blend (frames are fully composited), no dispose
		out.set(data, o);
		o += data.length;
	}

	return out;
}
