/** Transient "✓ confirmed" flag: trigger() shows it, auto-clears after
 *  durationMs (re-triggering restarts the timer). Value-keyed flashes
 *  (per-row ids) pass the id and compare `current === id`; boolean flashes
 *  call trigger() bare and read `current !== null`. */
export function createFlash<T = true>(durationMs: number) {
	let current = $state<T | null>(null);
	let timer: ReturnType<typeof setTimeout> | undefined;
	return {
		get current(): T | null {
			return current;
		},
		trigger(value: T = true as T) {
			clearTimeout(timer);
			current = value;
			timer = setTimeout(() => (current = null), durationMs);
		},
		clear() {
			clearTimeout(timer);
			current = null;
		}
	};
}
