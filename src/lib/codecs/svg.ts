import type { SvgCompressionSettings } from '$lib/types';
import { callWorker } from '$lib/workers/rpc';

export async function compressSvg(
	file: File,
	settings: SvgCompressionSettings,
	signal?: AbortSignal
): Promise<Blob> {
	const svg = await file.text();
	const result = await callWorker(
		'svg',
		'optimize',
		{ svg, settings: { ...settings } },
		[],
		undefined,
		{
			owner: signal
		}
	);
	return new Blob([result], { type: 'image/svg+xml' });
}
