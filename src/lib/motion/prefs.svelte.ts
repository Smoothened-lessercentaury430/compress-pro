import { MediaQuery } from 'svelte/reactivity';

// Server fallback is false ⇒ motionOK() true / pointerCoarse() false during
// prerender — same as the old $state(false) defaults. Reads stay live even
// under untrack(): the getter only skips the subscription, not the value.
const reduced = new MediaQuery('(prefers-reduced-motion: reduce)');
const coarse = new MediaQuery('(pointer: coarse)');

/** Reactive: true when it's OK to move things. SSR says yes; nothing animates server-side anyway. */
export function motionOK(): boolean {
	return !reduced.current;
}

/** Reactive: the primary input is touch — hover/drag affordances don't apply. SSR says false. */
export function pointerCoarse(): boolean {
	return coarse.current;
}
