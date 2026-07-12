import type { AudioConversionSettings } from '$lib/types';
import { callWorker } from '$lib/workers/rpc';
import { runCancellableVideoJob } from './graceful-cancel';
import { targetNotReachableWarning } from './target-search';
import { audioTargetBitrate } from './video-math';

export interface AudioProgress {
	fraction: number;
	detail: string | null;
}

export interface AudioResult {
	blob: Blob;
	warning: string | null;
	outputFormat: AudioConversionSettings['outputFormat'];
	/** Extension/mime differs from the source — disables the keep-original guard. */
	formatChanged: boolean;
}

const EXT: Record<AudioConversionSettings['outputFormat'], string[]> = {
	mp3: ['.mp3'],
	m4a: ['.m4a', '.aac'],
	wav: ['.wav'],
	ogg: ['.ogg', '.oga', '.opus']
};

export async function convertAudio(
	file: File,
	settings: AudioConversionSettings,
	onProgress?: (p: AudioProgress) => void,
	signal?: AbortSignal
): Promise<AudioResult> {
	const probe = await callWorker('video', 'probeAudio', { file });
	signal?.throwIfAborted();

	const targetBytes = Math.max(1, Math.round(settings.targetMb * 1_000_000));
	const useTarget = settings.mode === 'target' && settings.outputFormat !== 'wav';
	const bitrate = useTarget
		? audioTargetBitrate(targetBytes, probe.durationSec)
		: settings.bitrateKbps * 1000;

	return runCancellableVideoJob(signal, async (jobId) => {
		const out = await callWorker(
			'video',
			'convertAudio',
			{ jobId, file, output: settings.outputFormat, bitrate },
			[],
			(p) => onProgress?.({ fraction: Math.min(p.fraction, 0.99), detail: null })
		);

		const blob = new Blob([out.bytes], { type: out.mimeType });
		// WAV is PCM — there is no bitrate to steer, so target mode is ignored for
		// it (useTarget above). When that overshoots, say so instead of shipping a
		// silently oversized "target" result (persisted target mode + WAV output).
		const wavTargetIgnored = settings.mode === 'target' && settings.outputFormat === 'wav';
		const warning =
			useTarget && blob.size > targetBytes
				? targetNotReachableWarning(targetBytes, blob.size)
				: wavTargetIgnored && blob.size > targetBytes
					? 'WAV is uncompressed — the target size doesn’t apply to WAV output'
					: null;
		const name = file.name.toLowerCase();
		return {
			blob,
			warning,
			outputFormat: settings.outputFormat,
			formatChanged: !EXT[settings.outputFormat].some((ext) => name.endsWith(ext))
		};
	});
}
