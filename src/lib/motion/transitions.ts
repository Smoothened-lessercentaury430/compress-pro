import { cubicIn, cubicOut } from 'svelte/easing';
import type { TransitionConfig } from 'svelte/transition';
import { motionOK } from './prefs.svelte';

/** Exit transition: quick fade + slight shrink. (Exits must be Svelte transitions —
 *  attachment cleanup runs after DOM removal, so motion can't animate them.) */
export function fadeScale(
	node: Element,
	opts: { duration?: number; scale?: number; y?: number } = {}
): TransitionConfig {
	const { duration = 150, scale = 0.98, y = 0 } = opts;
	if (!motionOK()) return { duration: 100, css: (t) => `opacity: ${t}` };
	return {
		duration,
		easing: cubicIn,
		css: (t, u) => `opacity: ${t}; transform: scale(${1 - (1 - scale) * u}) translateY(${y * u}px)`
	};
}

/** Icon swap: rotate in from `from` degrees (use opposite signs for in/out). */
export function iconSpin(
	node: Element,
	opts: { duration?: number; from?: number } = {}
): TransitionConfig {
	const { duration = 220, from = 90 } = opts;
	if (!motionOK()) return { duration: 100, css: (t) => `opacity: ${t}` };
	return {
		duration,
		easing: cubicOut,
		css: (t, u) => `opacity: ${t}; transform: rotate(${from * u}deg) scale(${0.6 + 0.4 * t})`
	};
}
