<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		active: boolean;
		onclick: () => void;
		/** Overrides the solid-ink active look (e.g. the PDF Ultra/Extreme tints). */
		activeClass?: string;
		/** Numeric labels (audio bitrates) render in the mono stack. */
		mono?: boolean;
		children: Snippet;
	}

	let {
		active,
		onclick,
		activeClass = 'bg-ink text-ink-contrast',
		mono = false,
		children
	}: Props = $props();
</script>

<!-- The shared choice pill (output formats, bitrates, ZIP/PDF levels). e2e
     locates these via role=button + exact label + aria-pressed (setPill),
     so the anatomy stays: one <button>, the label as its only text. -->
<button
	type="button"
	aria-pressed={active}
	class={[
		'rounded-full px-4 py-2 text-sm font-medium transition-colors max-sm:py-2.5',
		mono && 'font-mono tabular-nums',
		active ? activeClass : 'bg-card-2 text-muted hover:text-ink'
	]}
	{onclick}
>
	{@render children()}
</button>
