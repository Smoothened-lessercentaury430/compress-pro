import { formatBytes } from '$lib/utils';

export interface SearchProgress {
	/** 1-based attempt counter. */
	attempt: number;
	attemptMax: number;
	/** Size of the last finished attempt. */
	lastSize?: number;
}

/**
 * Binary search over a quality ladder (rung 0 = best quality, output size
 * shrinking monotonically as the index grows) for the lowest rung whose
 * output fits `targetBytes`. Returns that output as `best` (null when no
 * rung fits) plus the smallest output seen as `smallest` — the caller's
 * fallback. `rungCount` must be ≥ 1.
 *
 * Progress framing: `onProgress(state)` before each attempt,
 * `onProgress({ ...state, lastSize })` after it. The attempt callback also
 * receives the state so callers can merge their inner (per-frame/per-page)
 * progress over it.
 *
 * An aborted `signal` stops the search between attempts (throws the
 * signal's AbortError) — without it, a cancel landing between attempts
 * would let the next attempt respawn workers and run to completion.
 */
export async function searchTargetSize<T>(
	rungCount: number,
	targetBytes: number,
	attempt: (rung: number, state: SearchProgress) => Promise<T>,
	sizeOf: (out: T) => number,
	onProgress?: (p: SearchProgress) => void,
	signal?: AbortSignal
): Promise<{ best: T | null; smallest: T }> {
	if (rungCount < 1) throw new Error('searchTargetSize needs at least one rung');
	const attemptMax = Math.ceil(Math.log2(rungCount + 1));
	let lo = 0;
	let hi = rungCount - 1;
	let best: T | null = null;
	let smallest: T | null = null;
	let attempts = 0;

	while (lo <= hi) {
		signal?.throwIfAborted();
		attempts++;
		const rung = (lo + hi) >> 1;
		const state: SearchProgress = { attempt: attempts, attemptMax };
		onProgress?.(state);

		const out = await attempt(rung, state);
		const size = sizeOf(out);
		onProgress?.({ ...state, lastSize: size });

		if (!smallest || size < sizeOf(smallest)) smallest = out;
		if (size <= targetBytes) {
			best = out;
			hi = rung - 1;
		} else {
			lo = rung + 1;
		}
	}

	return { best, smallest: smallest as T };
}

export function targetNotReachableWarning(targetBytes: number, smallestSize: number): string {
	return `Target ${formatBytes(targetBytes)} not reachable — smallest achievable is ${formatBytes(smallestSize)}`;
}
