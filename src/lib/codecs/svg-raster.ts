import type { SvgCompressionSettings } from '$lib/types';
import { encodeOnce } from './image';

/** ICO embeds 16–256 px; the vector renders crisp at exactly the largest. */
const ICO_RENDER_SIZE = 256;
const MIN_RASTER = 16;
const MAX_RASTER = 4096;

/**
 * Intrinsic size from the root <svg> tag: absolute width/height attributes
 * win, else viewBox extents, else null. Percentages carry no absolute size.
 * Pure string parsing — unit-testable in node.
 */
export function parseSvgSize(text: string): { width: number; height: number } | null {
	const root = text.match(/<svg[^>]*>/i)?.[0];
	if (!root) return null;
	const attr = (name: string) =>
		root.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']+)["']`, 'i'))?.[1];
	const px = (value: string | undefined) => {
		if (!value || value.includes('%')) return null;
		const n = parseFloat(value);
		return Number.isFinite(n) && n > 0 ? n : null;
	};
	const width = px(attr('width'));
	const height = px(attr('height'));
	if (width && height) return { width, height };
	const viewBox = attr('viewBox')
		?.trim()
		.split(/[\s,]+/)
		.map(Number);
	if (viewBox?.length === 4 && viewBox[2] > 0 && viewBox[3] > 0) {
		return { width: viewBox[2], height: viewBox[3] };
	}
	return null;
}

/**
 * Rewrite the root tag so the browser rasterizes AT the target resolution —
 * drawImage-upscaling an SVG with a small intrinsic size comes out blurry.
 * When only width/height exist, a matching viewBox is injected first so the
 * content scales with the new size instead of clipping.
 */
export function prepareSvgForRaster(text: string, width: number, height: number): string {
	const match = text.match(/<svg[^>]*>/i);
	if (!match || match.index === undefined) return text;
	let root = match[0];
	const original = parseSvgSize(text);
	if (!/\bviewBox\s*=/i.test(root) && original) {
		root = root.replace(/<svg/i, `<svg viewBox="0 0 ${original.width} ${original.height}"`);
	}
	root = root
		.replace(/\s(width|height)\s*=\s*["'][^"']*["']/gi, '')
		.replace(/<svg/i, `<svg width="${width}" height="${height}"`);
	return text.slice(0, match.index) + root + text.slice(match.index + match[0].length);
}

/**
 * Render an SVG file and encode it as PNG or ICO via the shared image worker.
 * Renders the ORIGINAL markup (never the SVGO output — its precision loss
 * must not leak into pixels). The lossless PNG intermediate feeds the
 * existing `encode` worker action, so quality/ICO muxing behave exactly like
 * the image tabs; the call is owner-tagged with `signal` for cancel scoping.
 */
export async function rasterizeSvg(
	file: File,
	settings: SvgCompressionSettings,
	signal?: AbortSignal
): Promise<{ blob: Blob; width: number; height: number }> {
	// Narrow up front — this path is only ever entered for raster outputs.
	const outputFormat = settings.outputFormat === 'ico' ? ('ico' as const) : ('png' as const);
	const text = await file.text();
	const size = parseSvgSize(text);
	const target =
		outputFormat === 'ico'
			? ICO_RENDER_SIZE
			: Math.min(MAX_RASTER, Math.max(MIN_RASTER, Math.round(settings.rasterSize || 1024)));
	// No size information anywhere → square render is the honest best effort.
	const aspect = size ? size.width / size.height : 1;
	const width = Math.max(1, aspect >= 1 ? target : Math.round(target * aspect));
	const height = Math.max(1, aspect >= 1 ? Math.round(target / aspect) : target);

	const url = URL.createObjectURL(
		new Blob([prepareSvgForRaster(text, width, height)], { type: 'image/svg+xml' })
	);
	let png: Blob | null;
	try {
		signal?.throwIfAborted();
		const img = new Image();
		await new Promise<void>((resolve, reject) => {
			img.onload = () => resolve();
			img.onerror = () => reject(new Error('This SVG could not be rendered — it may be malformed'));
			img.src = url;
		});
		const canvas = document.createElement('canvas');
		canvas.width = width;
		canvas.height = height;
		const ctx = canvas.getContext('2d');
		if (!ctx) throw new Error('Rendering the SVG failed (no canvas context)');
		ctx.drawImage(img, 0, 0, width, height);
		png = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
	} finally {
		URL.revokeObjectURL(url);
	}
	if (!png) throw new Error('Rendering the SVG failed');

	const out = await encodeOnce(
		await png.arrayBuffer(),
		outputFormat === 'png' ? settings.quality : 100,
		outputFormat,
		null,
		undefined,
		undefined,
		signal
	);
	const mime = outputFormat === 'ico' ? 'image/x-icon' : 'image/png';
	return { blob: new Blob([out.bytes], { type: mime }), width, height };
}
