import { browser } from '$app/environment';
import { MediaQuery } from 'svelte/reactivity';
import type { ThemeMode } from '$lib/types';

let mode: ThemeMode = $state('system');
// Server fallback is false → resolved 'light' while prerendering, same as the
// old $state(false); the pre-hydration class comes from app.html's IIFE.
const systemDark = new MediaQuery('(prefers-color-scheme: dark)');

if (browser) {
	const stored = localStorage.getItem('theme') as ThemeMode | null;
	if (stored === 'dark' || stored === 'light') mode = stored;
}

const resolved: 'light' | 'dark' = $derived(
	mode === 'system' ? (systemDark.current ? 'dark' : 'light') : mode
);

if (browser) {
	$effect.root(() => {
		$effect(() => {
			document.documentElement.classList.toggle('dark', resolved === 'dark');
			localStorage.setItem('theme', mode);
		});
	});
}

export const theme = {
	get mode() {
		return mode;
	},
	set mode(v: ThemeMode) {
		mode = v;
	},
	get resolved() {
		return resolved;
	},
	cycle() {
		mode = mode === 'system' ? 'dark' : mode === 'dark' ? 'light' : 'system';
	}
};
