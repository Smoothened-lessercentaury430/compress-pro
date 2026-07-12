import { describe, expect, it } from 'vitest';
import { runWithConcurrency } from './concurrency';

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

class Cancelled extends Error {}
const isCancel = (e: unknown) => e instanceof Cancelled;

describe('runWithConcurrency', () => {
	it('preserves input order regardless of completion order', async () => {
		// Task 0 finishes LAST; results must still land by index.
		const delays = [30, 5, 1, 12];
		const results = await runWithConcurrency(
			4,
			4,
			async (i) => {
				await new Promise((r) => setTimeout(r, delays[i]));
				return `r${i}`;
			},
			isCancel
		);
		expect(results).toEqual(['r0', 'r1', 'r2', 'r3']);
	});

	it('never runs more than `limit` jobs at once', async () => {
		let active = 0;
		let peak = 0;
		await runWithConcurrency(
			10,
			3,
			async () => {
				active++;
				peak = Math.max(peak, active);
				await tick();
				await tick();
				active--;
			},
			isCancel
		);
		expect(peak).toBe(3);
	});

	it('cancellation stops scheduling but keeps finished results', async () => {
		const started: number[] = [];
		const results = await runWithConcurrency(
			6,
			2,
			async (i) => {
				started.push(i);
				await tick();
				if (i === 2) throw new Cancelled();
				return i;
			},
			isCancel
		);
		expect(results[0]).toBe(0);
		expect(results[1]).toBe(1);
		expect(results[2]).toBeUndefined();
		// Nothing past the in-flight window starts after the cancel.
		expect(started).not.toContain(5);
	});

	it('isAborted() prevents new jobs from starting', async () => {
		let aborted = false;
		const started: number[] = [];
		const results = await runWithConcurrency(
			5,
			1,
			async (i) => {
				started.push(i);
				await tick();
				if (i === 1) aborted = true;
				return i;
			},
			isCancel,
			() => aborted
		);
		expect(started).toEqual([0, 1]);
		expect(results.filter((r) => r !== undefined)).toEqual([0, 1]);
	});

	it('a real error stops scheduling, lets in-flight settle, then rethrows', async () => {
		const finished: number[] = [];
		await expect(
			runWithConcurrency(
				6,
				2,
				async (i) => {
					if (i === 1) {
						throw new Error('boom');
					}
					await tick();
					await tick();
					finished.push(i);
					return i;
				},
				isCancel
			)
		).rejects.toThrow('boom');
		// The lane running task 0 settles cleanly before the rejection surfaces.
		expect(finished).toContain(0);
		expect(finished).not.toContain(5);
	});

	it('handles zero tasks and limit larger than count', async () => {
		expect(await runWithConcurrency(0, 4, async () => 1, isCancel)).toEqual([]);
		expect(await runWithConcurrency(2, 99, async (i) => i, isCancel)).toEqual([0, 1]);
	});
});
