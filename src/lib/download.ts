import type { CompressedFile } from '$lib/types';

export function downloadFile(file: CompressedFile): void {
	const a = document.createElement('a');
	a.href = file.objectUrl;
	a.download = file.name;
	a.click();
}

function uniqueName(name: string, used: Set<string>): string {
	if (!used.has(name)) return name;
	const dot = name.lastIndexOf('.');
	const stem = dot > 0 ? name.slice(0, dot) : name;
	const ext = dot > 0 ? name.slice(dot) : '';
	for (let n = 1; ; n++) {
		const candidate = `${stem} (${n})${ext}`;
		if (!used.has(candidate)) return candidate;
	}
}

export async function downloadAllAsZip(files: CompressedFile[]): Promise<void> {
	const { zip } = await import('fflate');

	const entries: Record<string, Uint8Array> = {};
	const used = new Set<string>();
	for (const file of files) {
		const name = uniqueName(file.name, used);
		used.add(name);
		entries[name] = new Uint8Array(await file.blob.arrayBuffer());
	}

	const zipped = await new Promise<Uint8Array>((resolve, reject) =>
		zip(entries, { level: 6 }, (error, data) => (error ? reject(error) : resolve(data)))
	);

	const blob = new Blob([zipped as BlobPart], { type: 'application/zip' });
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = 'compressed.zip';
	a.click();
	URL.revokeObjectURL(url);
}
