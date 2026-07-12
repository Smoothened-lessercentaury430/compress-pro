/**
 * Bounded-concurrency runner for per-file jobs. Results land by input index,
 * so downstream order (rows, ZIP entries) never depends on completion order.
 *
 * Stop semantics mirror the old serial loop:
 * - `isAborted()` true → no new jobs start; finished results are kept.
 * - a job throwing a cancellation (per `isCancel`) → same as aborted.
 * - a job throwing anything else → no new jobs start, in-flight jobs settle,
 *   then the first real error is rethrown. (compress.ts catches per-file
 *   errors inside the job itself, so this path is defensive there.)
 */
export async function runWithConcurrency<T>(
	count: number,
	limit: number,
	run: (index: number) => Promise<T>,
	isCancel: (error: unknown) => boolean,
	isAborted: () => boolean = () => false
): Promise<(T | undefined)[]> {
	const results: (T | undefined)[] = new Array(count);
	let next = 0;
	let stopped = false;
	let firstError: unknown = null;

	async function lane(): Promise<void> {
		while (!stopped) {
			if (isAborted()) {
				stopped = true;
				return;
			}
			const i = next++;
			if (i >= count) return;
			try {
				results[i] = await run(i);
			} catch (error) {
				stopped = true;
				if (!isCancel(error)) firstError ??= error;
				return;
			}
		}
	}

	const lanes = Math.max(1, Math.min(limit, count));
	await Promise.all(Array.from({ length: lanes }, () => lane()));
	if (firstError) throw firstError;
	return results;
}
