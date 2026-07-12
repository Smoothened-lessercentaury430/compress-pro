<script lang="ts">
	import Icon from './Icon.svelte';
	import { createFlash } from '$lib/flash.svelte';
	import { reveal } from '$lib/motion/reveal';
	import { pressable, arrowSwap } from '$lib/motion/gestures';

	interface Props {
		ondownloadall: () => void;
		/** Single-result runs reuse this button as a plain "Download file". */
		label?: string;
	}

	let { ondownloadall, label = 'Download All as ZIP' }: Props = $props();

	// Brief "✓" confirmation after the click (same pattern as FileList rows).
	const done = createFlash(2000);

	function handleDownloadAll() {
		ondownloadall();
		done.trigger();
	}
</script>

<!-- Exact button text is the e2e locator (`Download All as ZIP`). Lives in the
     CompressButton action row: shares a line with the stroke CTA on sm+, wraps
     to its own full-width line on phones. -->
<button
	onclick={handleDownloadAll}
	class="flex h-14 min-w-0 flex-1 items-center justify-center rounded-full bg-ink px-6 text-[15px] font-medium text-ink-contrast transition-colors max-sm:min-w-full hover:bg-ink/90"
	{@attach reveal({ y: 6 })}
	{@attach pressable()}
	{@attach arrowSwap(10, 'y')}
>
	<span class="grid">
		<span
			class="col-start-1 row-start-1 flex items-center justify-center gap-2 whitespace-nowrap transition-opacity duration-200 {done.current
				? 'opacity-0'
				: 'opacity-100'}"
		>
			<span data-arrow class="inline-flex">
				<Icon name="download" class="size-4" />
			</span>
			{label}
		</span>
		<span
			class="ease-pop col-start-1 row-start-1 grid place-items-center transition-all duration-200 {done.current
				? 'scale-100 opacity-100'
				: 'scale-50 opacity-0'}"
			aria-hidden={!done.current}
		>
			{#if done.current}
				<Icon name="check" class="icon-draw size-4" />
			{/if}
		</span>
	</span>
</button>
