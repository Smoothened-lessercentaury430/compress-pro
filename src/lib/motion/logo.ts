import { animate, hover, press } from 'motion';
import { untrack } from 'svelte';
import type { Attachment } from 'svelte/attachments';
import { motionOK } from './prefs.svelte';
import { SPRING_POP } from './tokens';

// viewBox units: +3 lands the chevron tips exactly on the bar's stroke edge
const SQUEEZE = 3;
const BAR_SQUASH = 0.8;
const IN = { duration: 0.14, ease: 'easeIn' } as const;
// starts right as the header's .reveal-css rise (0.55s) settles
const ENTRANCE_DELAY = 600;
// beat at full squeeze so the entrance pulse reads as "compress", not a twitch
const PULSE_HOLD = 140;

/** Logo "compress": chevrons squeeze toward the bar — one pulse on load, held while hovered. */
export function logoSqueeze(): Attachment {
	return (el) => {
		const [top, bar, bottom] = el.querySelectorAll<SVGPathElement>('svg path');
		if (!bottom) return;
		// the bar's scaleX must squash around its own center
		bar.style.transformBox = 'fill-box';
		bar.style.transformOrigin = 'center';

		const compress = () => {
			animate(top, { y: SQUEEZE }, IN);
			animate(bar, { scaleX: BAR_SQUASH }, IN);
			return animate(bottom, { y: -SQUEEZE }, IN);
		};
		const release = () => {
			animate(top, { y: 0 }, SPRING_POP);
			animate(bar, { scaleX: 1 }, SPRING_POP);
			animate(bottom, { y: 0 }, SPRING_POP);
		};

		// untrack: flipping the OS motion preference must not re-run a one-shot entrance.
		let held = false;
		let pulse: ReturnType<typeof setTimeout> | undefined;
		if (untrack(motionOK)) {
			pulse = setTimeout(() => {
				compress().then(() => {
					pulse = setTimeout(() => {
						if (!held) release();
					}, PULSE_HOLD);
				});
			}, ENTRANCE_DELAY);
		}

		const stopHover = hover(el, () => {
			if (!motionOK()) return;
			clearTimeout(pulse); // hovering during the entrance takes over
			held = true;
			compress();
			return () => {
				held = false;
				release();
			};
		});
		return () => {
			clearTimeout(pulse);
			stopHover();
		};
	};
}

// Error-page squeeze: here the DIGITS do the squashing, so chevron travel must
// cover the resting gap PLUS the glyph edge's recession toward its own center.
const DIGIT_SQUASH = 0.7;
const DIGIT_BULGE = 1.04;
const PRESS_K = 1.6; // a pointer press squeezes harder than the pulse
const IDLE_MS = 6000;

/**
 * Error-page "compress": the status digits squash between two brand chevrons —
 * entrance pulse, slow idle loop, hover holds, press flattens harder. The
 * `[data-sq-tick]` size readout (if present) fades in after the first release.
 */
export function errorSqueeze(): Attachment {
	return (el) => {
		const q = (sel: string) => el.querySelector<HTMLElement>(sel);
		const top = q('[data-sq-top]');
		const digits = q('[data-sq-digits]');
		const bottom = q('[data-sq-bottom]');
		const tick = q('[data-sq-tick]');
		const hit = q('[data-sq-hit]') ?? (el as HTMLElement);
		if (!top || !digits || !bottom) return;

		// untrack: flipping the OS motion preference must not re-run a one-shot entrance.
		const animated = untrack(motionOK);
		let ticked = true;
		if (animated && tick) {
			tick.style.opacity = '0';
			ticked = false;
		}

		// measured at rest; reveal-css only translates ancestors, so both stay true
		const gap = digits.getBoundingClientRect().top - top.getBoundingClientRect().bottom;
		const half = digits.getBoundingClientRect().height / 2;

		const compress = (k = 1) => {
			const squash = 1 - (1 - DIGIT_SQUASH) * k;
			// +2 lets the tips just kiss the squashed glyph
			const travel = gap + half * (1 - squash) + 2;
			animate(top, { y: travel }, IN);
			animate(digits, { scaleY: squash, scaleX: 1 + (DIGIT_BULGE - 1) * k }, IN);
			return animate(bottom, { y: -travel }, IN);
		};
		const release = () => {
			animate(top, { y: 0 }, SPRING_POP);
			animate(digits, { scaleY: 1, scaleX: 1 }, SPRING_POP);
			animate(bottom, { y: 0 }, SPRING_POP);
			if (tick && !ticked) {
				ticked = true;
				animate(tick, { opacity: [0, 1], x: [-6, 0] }, { ...SPRING_POP, delay: 0.06 });
			}
		};

		let hovered = false;
		let pressed = false;
		let hold: ReturnType<typeof setTimeout> | undefined;
		const pulse = () => {
			compress().then(() => {
				hold = setTimeout(() => {
					if (!hovered && !pressed) release();
				}, PULSE_HOLD);
			});
		};
		let entrance: ReturnType<typeof setTimeout> | undefined;
		if (animated) entrance = setTimeout(pulse, ENTRANCE_DELAY);
		const idle = setInterval(() => {
			if (motionOK() && !hovered && !pressed) pulse();
		}, IDLE_MS);

		const stopHover = hover(hit, () => {
			if (!motionOK()) return;
			clearTimeout(entrance); // hovering during the entrance takes over
			hovered = true;
			compress();
			return () => {
				hovered = false;
				if (!pressed) release();
			};
		});
		const stopPress = press(hit, () => {
			if (!motionOK()) return;
			clearTimeout(entrance);
			pressed = true;
			compress(PRESS_K);
			return () => {
				pressed = false;
				// still hovered → settle back to hover depth, not all the way out
				if (hovered) compress();
				else release();
			};
		});

		return () => {
			clearTimeout(entrance);
			clearTimeout(hold);
			clearInterval(idle);
			stopHover();
			stopPress();
		};
	};
}

/**
 * Hero h1 "compress": the `[data-squeeze]` word squashes once as the hero's
 * reveal settles, echoing the logo pulse. Attach to the persistent `<h1>` —
 * tab navigations only swap its text, so the entrance never re-fires.
 */
export function heroSqueeze(): Attachment {
	return (el) => {
		// untrack: flipping the OS motion preference must not re-run a one-shot entrance.
		if (!untrack(motionOK)) return;
		let pulse: ReturnType<typeof setTimeout> | undefined = setTimeout(() => {
			// resolved at fire time — a fast tab switch may have swapped the span
			const word = el.querySelector<HTMLElement>('[data-squeeze]');
			if (!word) return;
			// pure vertical squash — a scaleX bulge would transiently swallow the
			// space between the word and the rest of the heading
			word.style.transformOrigin = 'center 70%';
			animate(word, { scaleY: 0.78 }, IN).then(() => {
				pulse = setTimeout(() => {
					animate(word, { scaleY: 1 }, SPRING_POP);
				}, PULSE_HOLD);
			});
		}, ENTRANCE_DELAY + 60); // h1 sits at --reveal-i:1 — fire as its rise settles
		return () => clearTimeout(pulse);
	};
}
