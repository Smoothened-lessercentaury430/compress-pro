import { abortAll, callWorker } from '$lib/workers/rpc';

/** Job ids tie a running conversion to its graceful-cancel message. */
let nextJobId = 1;

/**
 * Runs one video-worker job with graceful cancellation: on abort the worker
 * gets a jobId-targeted `cancel` (conversion.cancel() makes the running job
 * throw while the worker itself survives), and a wedged worker that never
 * processes the cancel is hard-killed after 5 s. Listener and fallback timer
 * always clean up, success or failure.
 */
export async function runCancellableVideoJob<T>(
	signal: AbortSignal | undefined,
	run: (jobId: number) => Promise<T>
): Promise<T> {
	const jobId = nextJobId++;
	let fallbackTimer: ReturnType<typeof setTimeout> | undefined;
	const onAbort = () => {
		void callWorker('video', 'cancel', { jobId }).catch(() => {});
		// Deliberately kind-wide (no owner): this fires only when the single
		// shared video instance ignored the targeted cancel for 5 s — it is
		// wedged and cannot serve a concurrent audio/video job either. The
		// hard kill restores service; the co-victim surfaces as a failure row
		// (wasCancelled only trusts the run's own signal).
		fallbackTimer = setTimeout(() => abortAll(['video']), 5_000);
	};
	// An already-aborted signal never fires 'abort' — bail before arming anything.
	signal?.throwIfAborted();
	signal?.addEventListener('abort', onAbort, { once: true });
	try {
		return await run(jobId);
	} finally {
		signal?.removeEventListener('abort', onAbort);
		clearTimeout(fallbackTimer);
	}
}
