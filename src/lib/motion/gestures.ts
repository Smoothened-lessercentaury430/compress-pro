import { animate, hover, press } from 'motion';
import type { Attachment } from 'svelte/attachments';
import { motionOK } from './prefs.svelte';
import { SPRING_POP, SPRING_UI } from './tokens';

/** Press feedback: scale down on pointer-down/Enter, spring back on release. */
export function pressable(scale = 0.97): Attachment {
	return (el) =>
		press(el, (target) => {
			// disabled buttons still receive pointerdown in some browsers — no feedback for them
			if (!motionOK() || (el as HTMLButtonElement).disabled) return;
			animate(target, { scale }, { duration: 0.11, ease: 'easeOut' });
			return () => {
				animate(target, { scale: 1 }, SPRING_POP);
			};
		});
}

/** Subtle hover lift for primary CTAs. motion's hover() filters emulated touch-hover. */
export function hoverLift(dy = -1.5): Attachment {
	return (el) =>
		hover(el, (target) => {
			if (!motionOK()) return;
			animate(target, { y: dy }, SPRING_UI);
			return () => {
				animate(target, { y: 0 }, SPRING_UI);
			};
		});
}

/** Signature move: on hover the [data-arrow] child exits along `axis` (right/down)
 *  and re-enters from the opposite side. */
export function arrowSwap(distance = 14, axis: 'x' | 'y' = 'x'): Attachment {
	return (el) => {
		const arrow = el.querySelector<HTMLElement>('[data-arrow]');
		if (!arrow) return;
		let seq = 0;
		return hover(el, () => {
			if (!motionOK()) return;
			const id = ++seq;
			animate(arrow, { [axis]: distance, opacity: 0 }, { duration: 0.15, ease: 'easeIn' }).then(
				() => {
					if (id !== seq) return;
					animate(arrow, { [axis]: [-distance, 0], opacity: [0, 1] }, SPRING_UI);
				}
			);
			return () => {
				seq++;
				animate(arrow, { [axis]: 0, opacity: 1 }, { duration: 0.15, ease: 'easeOut' });
			};
		});
	};
}
