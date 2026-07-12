/**
 * Pure math for the video pipeline — kept worker-free so vitest covers it.
 */

export interface FittedDimensions {
	width: number;
	height: number;
	changed: boolean;
}

/**
 * Downscale-only fit of the longest side to `maxDimension`, aspect preserved.
 * Both sides land on EVEN numbers — 4:2:0 chroma subsampling (H.264/VP9)
 * requires it, and hardware encoders reject odd dimensions outright.
 */
export function fitDimensions(
	width: number,
	height: number,
	maxDimension: number | null
): FittedDimensions {
	const even = (n: number) => Math.max(2, Math.floor(n / 2) * 2);
	const longest = Math.max(width, height);
	if (!maxDimension || longest <= maxDimension) {
		const w = even(width);
		const h = even(height);
		// Sources with odd dimensions still need the even rounding to encode.
		return { width: w, height: h, changed: w !== width || h !== height };
	}
	const scale = maxDimension / longest;
	return {
		width: even(width * scale),
		height: even(height * scale),
		changed: true
	};
}

/** Downscale-only contain factor for the longest side (1 = leave as-is). */
export function containScale(width: number, height: number, maxDimension: number | null): number {
	if (!maxDimension) return 1;
	const longest = Math.max(width, height);
	return longest > maxDimension ? maxDimension / longest : 1;
}

/**
 * Delay of one animation frame. Browsers bump ≤10 ms GIF delays to 100 ms for
 * display — pass `gifQuirk` for GIF sources so the output plays like the GIF
 * looked; WebP/APNG timing is honored as-is.
 */
export function frameDelayMs(durationUs: number | null, gifQuirk: boolean): number {
	const ms = durationUs ? Math.round(durationUs / 1000) : 100;
	return gifQuirk && ms <= 10 ? 100 : ms;
}

/** Cap-only frame rate: undefined = leave the source rate untouched. */
export function capFrameRate(
	sourceFps: number | null,
	fps: 'original' | number
): number | undefined {
	if (fps === 'original') return undefined;
	if (sourceFps !== null && sourceFps <= fps) return undefined;
	return fps;
}

/** Relative bits each codec family needs for comparable perceptual quality. */
const CODEC_BITS: Record<string, number> = {
	av1: 0.6,
	hevc: 0.75,
	vp9: 0.7,
	avc: 1,
	vp8: 1.1
};

/**
 * Quality (1-100) → video bitrate via bits-per-pixel-per-frame. The curve
 * `0.02 · 15^(q/100)` spans ≈0.021 bppf (q1) to 0.30 bppf (q100), putting
 * q75 at ≈0.152 — around 9 Mbps for 1080p30 H.264, which matches common
 * "high quality" encoder presets. The codec factor comes from CODEC_BITS —
 * VP9/HEVC need fewer bits than H.264, VP8 needs more.
 */
export function qualityToBitrate(
	quality: number,
	width: number,
	height: number,
	fps: number,
	codec: 'avc' | 'hevc' | 'vp9' | 'vp8'
): number {
	const q = Math.min(100, Math.max(1, quality));
	const bppf = 0.02 * 15 ** (q / 100);
	return Math.max(120_000, Math.round(width * height * fps * bppf * CODEC_BITS[codec]));
}

/**
 * Cap a quality-mode bitrate by what the SOURCE stream actually carries —
 * information content can't exceed it, so re-encoding a 400 kbps web clip at
 * a resolution-derived 9 Mbps only balloons the file (measured +750% on a
 * real MOV before this cap). The cap scales with the quality slider
 * (q75 ≈ 1× source) and adjusts for codec-efficiency differences between
 * source and target (VP9 → H.264 needs more bits, not fewer).
 */
export function capBySourceBitrate(
	curveBps: number,
	quality: number,
	sourceVideoBps: number | null,
	sourceCodec: string | null,
	targetCodec: 'avc' | 'hevc' | 'vp9' | 'vp8'
): number {
	if (!sourceVideoBps || sourceVideoBps <= 0) return curveBps;
	const source = CODEC_BITS[sourceCodec ?? 'avc'] ?? 1;
	const target = CODEC_BITS[targetCodec] ?? 1;
	const crossFactor = Math.min(2, Math.max(0.5, target / source));
	const q = Math.min(100, Math.max(1, quality));
	const cap = sourceVideoBps * (q / 75) * crossFactor;
	return Math.max(120_000, Math.min(curveBps, Math.round(cap)));
}

/**
 * Target size → video bitrate. Derates by ~8% (single-pass VBR overshoots)
 * plus ~2% container overhead, then subtracts the audio budget.
 */
export function targetBitrate(targetBytes: number, durationSec: number, audioBps: number): number {
	const budgetBits = targetBytes * 8 * 0.92 * 0.98;
	const videoBits = budgetBits - audioBps * durationSec;
	return Math.max(120_000, Math.floor(videoBits / Math.max(0.1, durationSec)));
}

/**
 * `targetBitrate`, additionally capped by the source's own content — the same
 * q100 ceiling quality mode uses. Without it, a generous target on a
 * low-bitrate source balloons the file, and a container change (mov→mp4)
 * sidesteps the keep-original guard that would otherwise catch that.
 */
export function cappedTargetBitrate(
	targetBytes: number,
	durationSec: number,
	audioBps: number,
	sourceVideoBps: number | null,
	sourceCodec: string | null,
	targetCodec: 'avc' | 'hevc' | 'vp9' | 'vp8'
): number {
	const fromTarget = targetBitrate(targetBytes, durationSec, audioBps);
	return capBySourceBitrate(fromTarget, 100, sourceVideoBps, sourceCodec, targetCodec);
}

/** Corrective bitrate for the single verify-and-retry pass. */
export function retryBitrate(previous: number, actualBytes: number, targetBytes: number): number {
	return Math.max(120_000, Math.floor(previous * (targetBytes / actualBytes) * 0.95));
}

/**
 * Target size → AUDIO bitrate: ~3% container overhead, clamped to the sane
 * CBR range (32–320 kbps) — below 32 nothing is intelligible, above 320
 * encoders stop taking requests seriously.
 */
export function audioTargetBitrate(targetBytes: number, durationSec: number): number {
	const bits = targetBytes * 8 * 0.97;
	return Math.max(32_000, Math.min(320_000, Math.floor(bits / Math.max(0.1, durationSec))));
}

/** "01:23" / "1:02:03" for progress detail lines. */
export function formatTime(totalSeconds: number): string {
	const s = Math.max(0, Math.round(totalSeconds));
	const h = Math.floor(s / 3600);
	const m = Math.floor((s % 3600) / 60);
	const sec = s % 60;
	const mm = h > 0 ? String(m).padStart(2, '0') : String(m);
	return `${h > 0 ? `${h}:` : ''}${mm}:${String(sec).padStart(2, '0')}`;
}
