import { animate } from 'motion';
import { untrack } from 'svelte';
import type { Attachment } from 'svelte/attachments';
import { motionOK } from './prefs.svelte';
import { SPRING_POP, SPRING_REVEAL, STAGGER_CAP, STAGGER_STEP } from './tokens';

// Everything mounted in the same microtask flush forms one stagger batch —
// covers "controls + progress + list appear together" and "5 rows added at once".
let batch = 0;
let scheduled = false;
function nextIndex(): number {
	if (!scheduled) {
		scheduled = true;
		queueMicrotask(() => {
			batch = 0;
			scheduled = false;
		});
	}
	return batch++;
}

/** Enter: rise + fade, with automatic same-flush staggering. */
export function reveal(opts: { y?: number; delay?: number; stagger?: boolean } = {}): Attachment {
	return (el) => {
		const node = el as HTMLElement;
		// untrack: flipping the OS motion preference must not re-run a one-shot entrance.
		if (!untrack(motionOK)) {
			const controls = animate(node, { opacity: [0, 1] }, { duration: 0.15 });
			return () => controls.stop();
		}
		const delay =
			(opts.delay ?? 0) +
			(opts.stagger === false ? 0 : Math.min(nextIndex() * STAGGER_STEP, STAGGER_CAP));
		const controls = animate(
			node,
			{ opacity: [0, 1], y: [opts.y ?? 12, 0] },
			{ ...SPRING_REVEAL, delay }
		);
		return () => controls.stop();
	};
}

/** Enter: springy scale pop (chips, modal panel). */
export function pop(opts: { delay?: number; from?: number } = {}): Attachment {
	return (el) => {
		const node = el as HTMLElement;
		if (!untrack(motionOK)) {
			const controls = animate(node, { opacity: [0, 1] }, { duration: 0.15 });
			return () => controls.stop();
		}
		const controls = animate(
			node,
			{ opacity: [0, 1], scale: [opts.from ?? 0.8, 1] },
			{ ...SPRING_POP, delay: opts.delay ?? 0 }
		);
		return () => controls.stop();
	};
}

/** One-shot feedback pulse (e.g. after a successful drop). Call from event handlers. */
export function pulse(el: HTMLElement | undefined | null) {
	if (!el || !motionOK()) return;
	animate(el, { scale: [0.985, 1] }, SPRING_POP);
}
