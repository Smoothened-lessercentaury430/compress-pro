import { callWorker } from '$lib/workers/rpc';
import { getPdfjs, renderPdfPageToBlob } from '$lib/pdf-preview';
import { resolvePageRange, complementPages } from '$lib/pdf-range';

export type ToolProgress = (done: number, total: number, detail: string | null) => void;

// Longest rendered side; keeps 300 DPI renders of large pages within sane RAM.
const MAX_RENDER_PX = 8192;

async function loadPdf(file: File) {
	const { PDFDocument } = await import('pdf-lib');
	try {
		// ignoreEncryption lets password-less "owner-locked" PDFs load; truly
		// broken/encrypted content still throws below with the file name attached.
		return await PDFDocument.load(await file.arrayBuffer(), { ignoreEncryption: true });
	} catch (error) {
		throw new Error(
			`${file.name}: ${error instanceof Error ? error.message : 'could not read PDF'}`,
			{ cause: error }
		);
	}
}

export async function mergePdfs(files: File[], onProgress?: ToolProgress): Promise<Blob> {
	const { PDFDocument } = await import('pdf-lib');
	const out = await PDFDocument.create();
	for (let i = 0; i < files.length; i++) {
		onProgress?.(i, files.length + 1, files[i].name);
		const src = await loadPdf(files[i]);
		try {
			const pages = await out.copyPages(src, src.getPageIndices());
			for (const page of pages) out.addPage(page);
		} catch (error) {
			throw new Error(
				`${files[i].name}: ${error instanceof Error ? error.message : 'copy failed'} — if the file is encrypted, run Compress on it first (that rewrites it without encryption), then merge`,
				{ cause: error }
			);
		}
	}
	onProgress?.(files.length, files.length + 1, 'saving');
	const bytes = await out.save();
	return new Blob([bytes as BlobPart], { type: 'application/pdf' });
}

export async function extractPages(
	file: File,
	range: string,
	mode: 'keep' | 'remove'
): Promise<{ blob: Blob; kept: number; total: number }> {
	const src = await loadPdf(file);
	const total = src.getPageCount();
	let wanted: number[];
	try {
		wanted = resolvePageRange(range, total);
	} catch (error) {
		throw new Error(`${file.name}: ${error instanceof Error ? error.message : 'invalid range'}`, {
			cause: error
		});
	}
	const keep = mode === 'keep' ? wanted : complementPages(wanted, total);
	if (!keep.length) throw new Error(`${file.name}: selection would remove every page`);

	const { PDFDocument } = await import('pdf-lib');
	const out = await PDFDocument.create();
	const pages = await out.copyPages(
		src,
		keep.map((n) => n - 1)
	);
	for (const page of pages) out.addPage(page);
	const bytes = await out.save();
	return {
		blob: new Blob([bytes as BlobPart], { type: 'application/pdf' }),
		kept: keep.length,
		total
	};
}

export async function pdfToImages(
	file: File,
	opts: { dpi: 72 | 150 | 300; format: 'jpg' | 'png'; quality: number },
	onProgress?: ToolProgress
): Promise<{ blob: Blob; name: string; pages: number; warning: string | null }> {
	const pdfjs = await getPdfjs();
	const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
	try {
		const doc = await task.promise;
		const mime = opts.format === 'jpg' ? 'image/jpeg' : 'image/png';
		const stem = file.name.replace(/\.pdf$/i, '');
		const canvas = document.createElement('canvas'); // reused across pages
		const entries: Record<string, Uint8Array> = {};
		let single: Blob | null = null;
		let clampedAny = false;

		for (let n = 1; n <= doc.numPages; n++) {
			const rendered = await renderPdfPageToBlob(doc, n, {
				scale: opts.dpi / 72,
				maxPx: MAX_RENDER_PX,
				mime,
				quality: opts.quality / 100,
				canvas
			});
			clampedAny ||= rendered.clamped;
			if (doc.numPages === 1) {
				single = rendered.blob;
			} else {
				const pageName = `${stem}-p${String(n).padStart(2, '0')}.${opts.format}`;
				entries[pageName] = new Uint8Array(await rendered.blob.arrayBuffer());
			}
			onProgress?.(n, doc.numPages, `page ${n}/${doc.numPages}`);
		}

		const warning = clampedAny ? `Very large pages were rendered below ${opts.dpi} DPI` : null;
		if (single) {
			return { blob: single, name: `${stem}.${opts.format}`, pages: 1, warning };
		}
		const { zip } = await import('fflate');
		const zipped = await new Promise<Uint8Array>((resolve, reject) =>
			// level 0: jpg/png entries are already compressed
			zip(entries, { level: 0 }, (error, data) => (error ? reject(error) : resolve(data)))
		);
		return {
			blob: new Blob([zipped as BlobPart], { type: 'application/zip' }),
			name: `${stem}-images.zip`,
			pages: doc.numPages,
			warning
		};
	} finally {
		await task.destroy();
	}
}

export async function imagesToPdf(
	files: File[],
	opts: { quality: number },
	onProgress?: ToolProgress,
	signal?: AbortSignal
): Promise<Blob> {
	const { PDFDocument } = await import('pdf-lib');
	const out = await PDFDocument.create();

	for (let i = 0; i < files.length; i++) {
		// A cancel landing between page encodes has nothing pending to reject —
		// without this check the loop would carry on to the next page.
		signal?.throwIfAborted();
		onProgress?.(i, files.length + 1, files[i].name);
		const buffer = await files[i].arrayBuffer();
		// Re-encode via the existing image worker: predictable size, EXIF applied,
		// transparency flattened to white (mozjpeg would render it black).
		const encoded = await callWorker(
			'image',
			'encode',
			{ bytes: buffer, quality: opts.quality, output: 'jpg', maxDimension: null, flatten: true },
			[buffer],
			undefined,
			{ owner: signal }
		);
		const image = await out.embedJpg(encoded.bytes);
		// Page sized to the image (1 px = 1 pt), clamped to PDF's 14400 pt limit.
		const scale = Math.min(1, 14400 / Math.max(image.width, image.height));
		const page = out.addPage([image.width * scale, image.height * scale]);
		page.drawImage(image, { x: 0, y: 0, width: image.width * scale, height: image.height * scale });
	}

	onProgress?.(files.length, files.length + 1, 'saving');
	const bytes = await out.save();
	return new Blob([bytes as BlobPart], { type: 'application/pdf' });
}
