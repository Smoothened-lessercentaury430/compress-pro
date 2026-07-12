import { describe, expect, it } from 'vitest';
import {
	audioTargetBitrate,
	capBySourceBitrate,
	capFrameRate,
	cappedTargetBitrate,
	containScale,
	fitDimensions,
	formatTime,
	frameDelayMs,
	qualityToBitrate,
	retryBitrate,
	targetBitrate
} from './video-math';

describe('containScale', () => {
	it('shrinks the longest side to the cap, never upscales', () => {
		expect(containScale(2000, 1000, 500)).toBe(0.25);
		expect(containScale(1000, 2000, 500)).toBe(0.25);
		expect(containScale(400, 300, 500)).toBe(1);
		expect(containScale(500, 500, 500)).toBe(1);
	});

	it('treats a missing cap as no-op', () => {
		expect(containScale(9000, 9000, null)).toBe(1);
	});
});

describe('frameDelayMs', () => {
	it('bumps ≤10 ms delays to 100 ms only under the GIF quirk', () => {
		expect(frameDelayMs(10_000, true)).toBe(100);
		expect(frameDelayMs(10_000, false)).toBe(10);
		expect(frameDelayMs(2_000, true)).toBe(100);
	});

	it('honors real delays and defaults unknown ones to 100 ms', () => {
		expect(frameDelayMs(80_000, true)).toBe(80);
		expect(frameDelayMs(80_000, false)).toBe(80);
		expect(frameDelayMs(null, true)).toBe(100);
		expect(frameDelayMs(0, false)).toBe(100); // 0 is falsy → unknown
	});
});

describe('fitDimensions', () => {
	it('downscales the longest side, keeps aspect, lands on even numbers', () => {
		expect(fitDimensions(1920, 1080, 480)).toEqual({ width: 480, height: 270, changed: true });
		expect(fitDimensions(1080, 1920, 480)).toEqual({ width: 270, height: 480, changed: true });
	});

	it('never upscales', () => {
		expect(fitDimensions(320, 240, 1000)).toEqual({ width: 320, height: 240, changed: false });
	});

	it('evens odd source dimensions even without a cap', () => {
		const fit = fitDimensions(321, 241, null);
		expect(fit).toEqual({ width: 320, height: 240, changed: true });
	});

	it('never collapses below 2px', () => {
		const fit = fitDimensions(10_000, 10, 100);
		expect(fit.height).toBeGreaterThanOrEqual(2);
		expect(fit.width % 2).toBe(0);
	});
});

describe('capFrameRate', () => {
	it('caps only when the source exceeds the cap', () => {
		expect(capFrameRate(60, 30)).toBe(30);
		expect(capFrameRate(30, 30)).toBeUndefined();
		expect(capFrameRate(24, 30)).toBeUndefined();
		expect(capFrameRate(null, 60)).toBe(60); // unknown source: trust the cap
		expect(capFrameRate(120, 'original')).toBeUndefined();
	});
});

describe('qualityToBitrate', () => {
	it('is monotonic in quality', () => {
		const at = (q: number) => qualityToBitrate(q, 1920, 1080, 30, 'avc');
		expect(at(30)).toBeLessThan(at(60));
		expect(at(60)).toBeLessThan(at(90));
	});

	it('anchors q75@1080p30 avc in the 4-10 Mbps band', () => {
		const bps = qualityToBitrate(75, 1920, 1080, 30, 'avc');
		expect(bps).toBeGreaterThan(4_000_000);
		expect(bps).toBeLessThan(10_000_000);
	});

	it('gives vp9 ~30% fewer bits and floors at 120 kbps', () => {
		const avc = qualityToBitrate(75, 1280, 720, 30, 'avc');
		const vp9 = qualityToBitrate(75, 1280, 720, 30, 'vp9');
		expect(vp9 / avc).toBeCloseTo(0.7, 1);
		expect(qualityToBitrate(1, 160, 120, 10, 'vp9')).toBe(120_000);
	});

	it('budgets by codec efficiency: vp8 needs MORE bits than avc, hevc fewer', () => {
		const avc = qualityToBitrate(75, 1280, 720, 30, 'avc');
		expect(qualityToBitrate(75, 1280, 720, 30, 'vp8') / avc).toBeCloseTo(1.1, 1);
		expect(qualityToBitrate(75, 1280, 720, 30, 'hevc') / avc).toBeCloseTo(0.75, 1);
	});
});

describe('capBySourceBitrate', () => {
	it('caps a resolution-derived bitrate by what the source carries', () => {
		// 9 Mbps curve vs a 400 kbps web clip at q75, avc→avc: cap wins.
		expect(capBySourceBitrate(9_000_000, 75, 400_000, 'avc', 'avc')).toBe(400_000);
	});

	it('leaves high-bitrate camera footage on the curve', () => {
		expect(capBySourceBitrate(9_000_000, 75, 50_000_000, 'hevc', 'avc')).toBe(9_000_000);
	});

	it('scales with the quality slider', () => {
		expect(capBySourceBitrate(9_000_000, 30, 1_000_000, 'avc', 'avc')).toBe(400_000);
		expect(capBySourceBitrate(9_000_000, 100, 1_000_000, 'avc', 'avc')).toBe(1_333_333);
	});

	it('grants extra bits when converting from a stronger codec', () => {
		// VP9 source → H.264 target needs ~1.43× the bits for the same quality.
		expect(capBySourceBitrate(9_000_000, 75, 700_000, 'vp9', 'avc')).toBe(1_000_000);
	});

	it('is a no-op without source stats and floors at 120 kbps', () => {
		expect(capBySourceBitrate(9_000_000, 75, null, null, 'avc')).toBe(9_000_000);
		expect(capBySourceBitrate(9_000_000, 1, 100_000, 'avc', 'avc')).toBe(120_000);
	});
});

describe('targetBitrate', () => {
	it('subtracts the audio budget and derates for overshoot', () => {
		// 25 MB, 60 s, 128 kbps audio → well under the naive 25MB*8/60.
		const bps = targetBitrate(25_000_000, 60, 128_000);
		const naive = (25_000_000 * 8) / 60;
		expect(bps).toBeLessThan(naive);
		expect(bps).toBeGreaterThan(naive * 0.8);
	});

	it('floors at 120 kbps for absurd targets', () => {
		expect(targetBitrate(10_000, 600, 128_000)).toBe(120_000);
	});
});

describe('cappedTargetBitrate', () => {
	it('caps a generous target by the source ceiling (q100, cross-codec aware)', () => {
		// 50 MB target for a 60 s / 400 kbps avc clip → source ceiling wins:
		// 400k · (100/75) ≈ 533 kbps, far below the ~6.5 Mbps the target allows.
		const bps = cappedTargetBitrate(50_000_000, 60, 128_000, 400_000, 'avc', 'avc');
		expect(bps).toBe(Math.round(400_000 * (100 / 75)));
	});

	it('keeps the target math when it is the binding constraint', () => {
		const uncapped = targetBitrate(2_000_000, 60, 128_000);
		expect(cappedTargetBitrate(2_000_000, 60, 128_000, 8_000_000, 'avc', 'avc')).toBe(uncapped);
	});

	it('is targetBitrate when source stats are unknown', () => {
		expect(cappedTargetBitrate(5_000_000, 30, 0, null, null, 'vp9')).toBe(
			targetBitrate(5_000_000, 30, 0)
		);
	});
});

describe('audioTargetBitrate', () => {
	it('derives the bitrate from target size and duration with 3% overhead', () => {
		// 50 KB for 3 s → ~129 kbps
		expect(audioTargetBitrate(50_000, 3)).toBe(Math.floor((50_000 * 8 * 0.97) / 3));
	});

	it('clamps to the sane CBR range', () => {
		expect(audioTargetBitrate(1_000, 600)).toBe(32_000); // absurdly small
		expect(audioTargetBitrate(100_000_000, 3)).toBe(320_000); // absurdly large
	});
});

describe('retryBitrate', () => {
	it('scales down proportionally with an extra 5% margin', () => {
		expect(retryBitrate(1_000_000, 30_000_000, 25_000_000)).toBe(
			Math.floor(1_000_000 * (25 / 30) * 0.95)
		);
	});
});

describe('formatTime', () => {
	it('formats mm:ss and h:mm:ss', () => {
		expect(formatTime(0)).toBe('0:00');
		expect(formatTime(62)).toBe('1:02');
		expect(formatTime(3723)).toBe('1:02:03');
	});
});
