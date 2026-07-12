// SSR prerenders ⌘V; non-Apple platforms swap after hydration (the layout
// calls detectPasteKey() from an effect — client-only, so there is no
// hydration text mismatch).
let key = $state('⌘V');

export function pasteKey(): string {
	return key;
}

export function detectPasteKey() {
	if (!/Mac|iP(hone|ad|od)/.test(navigator.platform || navigator.userAgent)) key = 'Ctrl+V';
}
