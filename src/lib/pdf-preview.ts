import type { PDFDocumentProxy } from 'pdfjs-dist';

let workerConfigured = false;

export async function getPdfjs() {
	const pdfjs = await import('pdfjs-dist');
	if (!workerConfigured) {
		const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
		pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
		workerConfigured = true;
	}
	return pdfjs;
}

export interface RenderedPage {
	blob: Blob;
	width: number;
	height: number;
	/** True when maxPx forced a lower scale than requested. */
	clamped: boolean;
}

/** Renders one page to an image blob; reuses `canvas` across calls when given. */
export async function renderPdfPageToBlob(
	doc: PDFDocumentProxy,
	pageNum: number,
	opts: {
		scale: number;
		maxPx?: number;
		mime: 'image/png' | 'image/jpeg';
		/** 0..1, JPEG only. */
		quality?: number;
		canvas?: HTMLCanvasElement;
	}
): Promise<RenderedPage> {
	const page = await doc.getPage(pageNum);
	try {
		const base = page.getViewport({ scale: 1 });
		const maxPx = opts.maxPx ?? Infinity;
		const scale = Math.min(opts.scale, maxPx / base.width, maxPx / base.height);
		const viewport = page.getViewport({ scale });

		const canvas = opts.canvas ?? document.createElement('canvas');
		canvas.width = Math.ceil(viewport.width);
		canvas.height = Math.ceil(viewport.height);
		const canvasContext = canvas.getContext('2d');
		if (!canvasContext) throw new Error('Canvas 2d context unavailable');

		await page.render({ canvas, canvasContext, viewport }).promise;

		const blob = await new Promise<Blob | null>((resolve) =>
			canvas.toBlob(resolve, opts.mime, opts.quality)
		);
		if (!blob) throw new Error('Failed to render PDF page');
		return { blob, width: canvas.width, height: canvas.height, clamped: scale < opts.scale };
	} finally {
		page.cleanup();
	}
}

export interface PdfPreviewHandle {
	numPages: number;
	/** Renders one page to a PNG object URL (caller revokes it). */
	renderPage(pageNum: number): Promise<string>;
	destroy(): Promise<void>;
}

/** Opens a PDF blob for repeated page previews; caller must destroy() when done. */
export async function openPdfPreview(source: Blob, maxWidth = 1600): Promise<PdfPreviewHandle> {
	const pdfjs = await getPdfjs();
	const data = new Uint8Array(await source.arrayBuffer());
	const loadingTask = pdfjs.getDocument({ data });
	const doc = await loadingTask.promise;

	return {
		numPages: doc.numPages,
		async renderPage(pageNum: number) {
			const { blob } = await renderPdfPageToBlob(doc, pageNum, {
				scale: 4,
				maxPx: maxWidth,
				mime: 'image/png'
			});
			return URL.createObjectURL(blob);
		},
		async destroy() {
			await loadingTask.destroy();
		}
	};
}
