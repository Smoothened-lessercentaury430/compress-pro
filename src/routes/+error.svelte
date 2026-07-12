<script lang="ts">
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import Icon from '$lib/components/Icon.svelte';
	import { pressable, hoverLift, arrowSwap } from '$lib/motion/gestures';
	import { errorSqueeze } from '$lib/motion/logo';

	const notFound = $derived(page.status === 404);
</script>

<svelte:head>
	<title>{notFound ? 'Page not found' : 'Something broke'} — Compress Pro</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<div class="py-16 text-center">
	<!-- The status code gets the brand treatment: chevrons squeeze the digits
	     like the logo squeezes its bar — entrance pulse, slow idle loop, hover
	     holds, press flattens harder. Decorative; the heading carries meaning. -->
	<div aria-hidden="true" {@attach errorSqueeze()}>
		<div
			data-sq-hit
			class="reveal-css inline-flex flex-col items-center select-none"
			style="--reveal-i: 0"
		>
			<svg
				data-sq-top
				class="w-16 text-ink"
				viewBox="0 0 24 11"
				fill="none"
				stroke="currentColor"
				stroke-width="2"
				stroke-linecap="butt"
				stroke-linejoin="miter"
			>
				<path d="M4 2l8 7 8-7" />
			</svg>
			<span data-sq-digits class="text-hero my-1.5 text-ink">{page.status}</span>
			<svg
				data-sq-bottom
				class="w-16 text-ink"
				viewBox="0 0 24 11"
				fill="none"
				stroke="currentColor"
				stroke-width="2"
				stroke-linecap="butt"
				stroke-linejoin="miter"
			>
				<path d="M4 9l8-7 8 7" />
			</svg>
		</div>
		{#if notFound}
			<p class="reveal-css microlabel mt-6 text-faint" style="--reveal-i: 1">
				404 KB <span data-sq-tick class="inline-block">→ 0 B</span>
			</p>
		{/if}
	</div>
	<h1 class="reveal-css mt-8 text-display text-ink" style="--reveal-i: 2">
		{notFound ? 'Compressed out of existence.' : 'Something broke.'}
	</h1>
	<p class="reveal-css mt-3.5 text-sm text-muted" style="--reveal-i: 3">
		{notFound
			? 'This page is 0 bytes — it doesn’t exist. Check the address, or head back to the tools.'
			: (page.error?.message ?? 'An unexpected error occurred.')}
	</p>
	<div class="reveal-css mt-8" style="--reveal-i: 4">
		<a
			href={resolve('/')}
			class="inline-flex items-center gap-2 rounded-full bg-ink px-5 py-2.5 text-sm font-medium text-ink-contrast transition-colors hover:bg-ink/90"
			{@attach pressable()}
			{@attach hoverLift()}
			{@attach arrowSwap(-10)}
		>
			<span data-arrow class="inline-flex">
				<Icon name="arrow-left" class="size-4" />
			</span>
			Back to Compress Pro
		</a>
	</div>
</div>
