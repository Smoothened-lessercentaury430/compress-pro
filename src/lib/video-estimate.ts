/**
 * UI-side output-size predictions for the video & audio tabs — the video path
 * runs the SAME bitrate math the encoder uses (video-math.ts), so the estimate
 * tracks reality; only fps (not exposed by <video>) is assumed.
 */
import type { VideoConversionSettings } from '$lib/types';
import { capBySourceBitrate, fitDimensions, qualityToBitrate } from '$lib/codecs/video-math';
import type { MediaMeta } from '$lib/media-meta.svelte';

/** Mirrors AUDIO_BITRATE in codecs/video.ts — quality-mode audio budget. */
const AUDIO_BPS = 128_000;
/** Muxing overhead on top of the raw streams. */
const CONTAINER_OVERHEAD = 1.02;

export interface VideoEstimateInput {
	meta: MediaMeta;
	/** Source file size — proxies the source bitrate for the encoder's cap. */
	bytes: number;
}

export function estimateVideoBytes(
	files: VideoEstimateInput[],
	settings: VideoConversionSettings
): number | null {
	// GIF output is palette-based — its size doesn't follow bitrate math.
	if (settings.container === 'gif' || files.length === 0) return null;
	const codec = settings.container === 'webm' ? 'vp9' : 'avc';
	let total = 0;
	for (const { meta, bytes } of files) {
		if (meta.width <= 0 || meta.height <= 0 || meta.durationSec <= 0) return null;
		const dims = fitDimensions(meta.width, meta.height, settings.maxDimension);
		// <video> can't report fps — assume the common 30, capped by the setting.
		const fps = settings.fps === 'original' ? 30 : Math.min(30, settings.fps);
		const curve = qualityToBitrate(settings.quality, dims.width, dims.height, fps, codec);
		// Source video bitrate ≈ the whole file minus a typical audio track.
		const sourceVideoBps = Math.max(0, (bytes * 8) / meta.durationSec - AUDIO_BPS);
		const videoBps = capBySourceBitrate(
			curve,
			settings.quality,
			sourceVideoBps > 0 ? sourceVideoBps : null,
			null,
			codec
		);
		const audioBps = settings.removeAudio ? 0 : AUDIO_BPS;
		total += ((videoBps + audioBps) * meta.durationSec) / 8;
	}
	return Math.round(total * CONTAINER_OVERHEAD);
}

/** Bitrate-mode audio: kbps × duration is near-exact (±10% on real content). */
export function estimateAudioBytes(durationsSec: number[], kbps: number): number | null {
	if (durationsSec.length === 0) return null;
	const total = durationsSec.reduce((sum, d) => sum + (kbps * 1000 * d) / 8, 0);
	return Math.round(total * 1.03);
}
