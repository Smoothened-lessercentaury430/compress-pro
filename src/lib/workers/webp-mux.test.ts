import { describe, expect, it } from 'vitest';
import { sniffAnimatedInput } from './webp-mux';

function bytes(...parts: (string | number[])[]): ArrayBuffer {
	const out: number[] = [];
	for (const part of parts) {
		if (typeof part === 'string') for (const ch of part) out.push(ch.charCodeAt(0));
		else out.push(...part);
	}
	return new Uint8Array(out).buffer;
}

/** RIFF/WEBP/VP8X header up to byte 20 (the feature-flags byte). */
function vp8xHeader(flags: number): ArrayBuffer {
	return bytes(
		'RIFF',
		[0, 0, 0, 0], // RIFF size (irrelevant to the sniffer)
		'WEBP',
		'VP8X',
		[10, 0, 0, 0], // VP8X chunk size
		[flags],
		[0, 0, 0] // padding past byte 21
	);
}

describe('sniffAnimatedInput', () => {
	it('detects GIF by magic', () => {
		expect(sniffAnimatedInput(bytes('GIF87a', [0, 0, 0]))).toBe('image/gif');
		expect(sniffAnimatedInput(bytes('GIF89a', [0, 0, 0]))).toBe('image/gif');
	});

	it('detects animated WebP (VP8X with the ANIM flag set)', () => {
		expect(sniffAnimatedInput(vp8xHeader(0x02))).toBe('image/webp');
		expect(sniffAnimatedInput(vp8xHeader(0x12))).toBe('image/webp'); // ANIM + other flags
	});

	it('returns null for a still VP8X WebP (no ANIM flag)', () => {
		expect(sniffAnimatedInput(vp8xHeader(0x00))).toBeNull();
		expect(sniffAnimatedInput(vp8xHeader(0x10))).toBeNull(); // ALPHA only
	});

	it('returns null for a simple (non-VP8X) WebP', () => {
		expect(
			sniffAnimatedInput(bytes('RIFF', [0, 0, 0, 0], 'WEBP', 'VP8 ', [0, 0, 0, 0, 0]))
		).toBeNull();
	});

	it('returns null for short or unrelated buffers', () => {
		expect(sniffAnimatedInput(bytes('GI'))).toBeNull();
		expect(sniffAnimatedInput(new ArrayBuffer(0))).toBeNull();
		expect(
			sniffAnimatedInput(bytes('%PDF-1.5', [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]))
		).toBeNull();
	});
});
