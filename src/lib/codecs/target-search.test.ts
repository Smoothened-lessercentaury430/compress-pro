import { describe, expect, it } from 'vitest';
import { searchTargetSize, targetNotReachableWarning, type SearchProgress } from './target-search';

/** Monotone ladder: rung i encodes to sizes[i] bytes. */
function ladder(sizes: number[]) {
	const visited: number[] = [];
	const attempt = async (rung: number) => {
		visited.push(rung);
		return { rung, size: sizes[rung] };
	};
	const sizeOf = (out: { size: number }) => out.size;
	return { visited, attempt, sizeOf };
}

describe('searchTargetSize', () => {
	// rung 0 = best quality = biggest output, shrinking monotonically.
	const SIZES = [100, 90, 80, 70, 60, 50, 40, 30, 20, 10];

	it('finds the lowest rung (best quality) that fits the target', async () => {
		const { attempt, sizeOf } = ladder(SIZES);
		const { best } = await searchTargetSize(SIZES.length, 55, attempt, sizeOf);
		// Rungs 5..9 fit (≤55); the search must pick rung 5 (size 50).
		expect(best?.rung).toBe(5);
		expect(best?.size).toBe(50);
	});

	it('returns the exact-fit rung when the target equals a rung size', async () => {
		const { attempt, sizeOf } = ladder(SIZES);
		const { best } = await searchTargetSize(SIZES.length, 60, attempt, sizeOf);
		expect(best?.size).toBe(60);
	});

	it('returns best=null and the smallest visited output when nothing fits', async () => {
		const { attempt, sizeOf } = ladder(SIZES);
		const { best, smallest } = await searchTargetSize(SIZES.length, 5, attempt, sizeOf);
		expect(best).toBeNull();
		expect(smallest.size).toBe(10); // bottom rung gets probed on the way down
	});

	it('picks rung 0 outright when everything fits', async () => {
		const { attempt, sizeOf } = ladder(SIZES);
		const { best } = await searchTargetSize(SIZES.length, 1000, attempt, sizeOf);
		expect(best?.rung).toBe(0);
	});

	it('stays within attemptMax = ceil(log2(rungs+1)) probes', async () => {
		for (const target of [5, 55, 60, 1000]) {
			const { visited, attempt, sizeOf } = ladder(SIZES);
			await searchTargetSize(SIZES.length, target, attempt, sizeOf);
			expect(visited.length).toBeLessThanOrEqual(Math.ceil(Math.log2(SIZES.length + 1)));
		}
	});

	it('emits the documented progress sequence: state before, lastSize after', async () => {
		const events: SearchProgress[] = [];
		const { attempt, sizeOf } = ladder(SIZES);
		await searchTargetSize(SIZES.length, 55, attempt, sizeOf, (p) => events.push({ ...p }));

		expect(events.length % 2).toBe(0);
		const attemptMax = Math.ceil(Math.log2(SIZES.length + 1));
		for (let i = 0; i < events.length; i += 2) {
			const before = events[i];
			const after = events[i + 1];
			expect(before.attempt).toBe(i / 2 + 1);
			expect(before.attemptMax).toBe(attemptMax);
			expect(before.lastSize).toBeUndefined();
			expect(after.attempt).toBe(before.attempt);
			expect(after.lastSize).toBeGreaterThan(0);
		}
	});

	it('hands the same state object contents to the attempt callback', async () => {
		const seen: SearchProgress[] = [];
		const sizes = [100, 50, 10];
		await searchTargetSize(
			sizes.length,
			60,
			async (rung, state) => {
				seen.push({ ...state });
				return sizes[rung];
			},
			(size) => size
		);
		seen.forEach((state, i) => {
			expect(state.attempt).toBe(i + 1);
			expect(state.attemptMax).toBe(Math.ceil(Math.log2(sizes.length + 1)));
		});
	});
});

describe('searchTargetSize guards', () => {
	it('rejects an empty ladder instead of returning a lying smallest', async () => {
		await expect(
			searchTargetSize(
				0,
				100,
				async () => 0,
				(n) => n
			)
		).rejects.toThrow(/at least one rung/);
	});

	it('throws AbortError before the first attempt on a pre-aborted signal', async () => {
		const controller = new AbortController();
		controller.abort();
		let calls = 0;
		await expect(
			searchTargetSize(
				10,
				5,
				async () => {
					calls++;
					return 100;
				},
				(n) => n,
				undefined,
				controller.signal
			)
		).rejects.toMatchObject({ name: 'AbortError' });
		expect(calls).toBe(0);
	});

	it('stops between attempts when the signal aborts mid-search', async () => {
		const controller = new AbortController();
		let calls = 0;
		await expect(
			searchTargetSize(
				10,
				5, // never fits → would probe several rungs without the abort
				async () => {
					calls++;
					controller.abort();
					return 100;
				},
				(n) => n,
				undefined,
				controller.signal
			)
		).rejects.toMatchObject({ name: 'AbortError' });
		expect(calls).toBe(1);
	});
});

describe('targetNotReachableWarning', () => {
	it('names both the target and the smallest achievable size', () => {
		expect(targetNotReachableWarning(500_000, 750_000)).toBe(
			'Target 500 KB not reachable — smallest achievable is 750 KB'
		);
	});
});
