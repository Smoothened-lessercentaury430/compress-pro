import { describe, expect, it } from 'vitest';
import { formatBytes, formatSignedPercent } from './utils';

describe('formatBytes', () => {
	it('formats with SI base 1000, matching the target-size math', () => {
		expect(formatBytes(0)).toBe('0 B');
		expect(formatBytes(999)).toBe('999 B');
		expect(formatBytes(1000)).toBe('1 KB');
		// A "500 KB" target (500,000 B) must read back as exactly 500 KB.
		expect(formatBytes(500_000)).toBe('500 KB');
		expect(formatBytes(1_500_000)).toBe('1.5 MB');
		expect(formatBytes(2_000_000_000)).toBe('2 GB');
	});

	it('respects the decimals parameter', () => {
		expect(formatBytes(1_234_567, 2)).toBe('1.23 MB');
		expect(formatBytes(1_234_567, 0)).toBe('1 MB');
	});

	it('clamps to the largest unit instead of running off the table', () => {
		expect(formatBytes(5_000_000_000_000)).toBe('5000 GB');
	});
});

describe('formatSignedPercent', () => {
	it('uses a minus sign for savings and a plus when the file grew', () => {
		expect(formatSignedPercent(37)).toBe('−37%');
		expect(formatSignedPercent(-12)).toBe('+12%');
		expect(formatSignedPercent(0)).toBe('−0%');
		expect(formatSignedPercent(12.6)).toBe('−13%');
	});
});
