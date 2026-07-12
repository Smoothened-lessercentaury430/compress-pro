import type { Attachment } from 'svelte/attachments';

const FOCUSABLE =
	'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), ' +
	'textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';

/**
 * Dialog focus management: moves focus into the container on mount, keeps
 * Tab/Shift+Tab cycling inside it, and restores focus to the previously
 * focused element on teardown. The container needs tabindex="-1" so it can
 * take initial focus itself.
 */
export function trapFocus(): Attachment<HTMLElement> {
	return (container) => {
		const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
		container.focus();

		const onKeydown = (event: KeyboardEvent) => {
			if (event.key !== 'Tab') return;
			const focusable = [...container.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
				(el) => el.offsetParent !== null || el === document.activeElement
			);
			if (!focusable.length) {
				event.preventDefault();
				return;
			}
			const first = focusable[0];
			const last = focusable[focusable.length - 1];
			const active = document.activeElement;
			if (event.shiftKey && (active === first || active === container)) {
				event.preventDefault();
				last.focus();
			} else if (!event.shiftKey && active === last) {
				event.preventDefault();
				first.focus();
			}
		};

		container.addEventListener('keydown', onKeydown);
		return () => {
			container.removeEventListener('keydown', onKeydown);
			previous?.focus();
		};
	};
}
