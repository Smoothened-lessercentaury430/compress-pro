import type { CompressedFile } from '$lib/types';

const COPYABLE_IMAGE = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/avif']);

export function canCopyToClipboard(result: CompressedFile): boolean {
	if (typeof ClipboardItem === 'undefined' || !navigator.clipboard?.write) return false;
	// Detect-if-present: absent supports() means PNG (the mandated type) works.
	if (ClipboardItem.supports && !ClipboardItem.supports('image/png')) return false;
	return COPYABLE_IMAGE.has(result.blob.type) || result.blob.type === 'image/svg+xml';
}

/**
 * MUST be called synchronously inside the click handler: Safari drops the
 * user-gesture chain across awaits, so async data goes into the ClipboardItem
 * as a Promise instead (spec-sanctioned, works in all engines).
 */
export function copyResultToClipboard(result: CompressedFile): Promise<void> {
	if (result.blob.type === 'image/svg+xml') {
		return navigator.clipboard.write([new ClipboardItem({ 'text/plain': result.blob.text() })]);
	}
	// Chromium only accepts image/png on write — transcode everything else.
	const png = result.blob.type === 'image/png' ? result.blob : transcodeToPng(result.blob);
	return navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
}

async function transcodeToPng(blob: Blob): Promise<Blob> {
	const bitmap = await createImageBitmap(blob);
	try {
		const canvas = document.createElement('canvas');
		canvas.width = bitmap.width;
		canvas.height = bitmap.height;
		const context = canvas.getContext('2d');
		if (!context) throw new Error('Canvas 2d context unavailable');
		context.drawImage(bitmap, 0, 0);
		const out = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
		if (!out) throw new Error('PNG transcode failed');
		return out;
	} finally {
		bitmap.close();
	}
}
