<script lang="ts">
	import type { Snippet } from 'svelte';
	import { fade } from 'svelte/transition';
	import { createFlash } from '$lib/flash.svelte';
	import { pressable } from '$lib/motion/gestures';
	import { pulse } from '$lib/motion/reveal';
	import Icon from '../Icon.svelte';
	import Spinner from '../Spinner.svelte';

	interface Props {
		label: string;
		busyLabel: string;
		oncompress: () => void;
		/** Cancels the running job; the button shows only while isCompressing. */
		oncancel?: () => void;
		disabled: boolean;
		isCompressing: boolean;
		/** The last run errored — suppresses the "Done" flash. */
		hasError?: boolean;
		/** Results exist — the CTA steps back to a stroke button so a primary
		 *  action (Download All as ZIP) can take the solid slot beside it. */
		secondary?: boolean;
		/** Extra buttons rendered in the same action row (the ZIP download). */
		children?: Snippet;
	}

	let {
		label,
		busyLabel,
		oncompress,
		oncancel,
		disabled,
		isCompressing,
		hasError = false,
		secondary = false,
		children
	}: Props = $props();

	// Green "Done ✓" flash on the CTA when a run finishes cleanly.
	const done = createFlash(1500);
	let btnEl: HTMLButtonElement | undefined = $state();
	let prevCompressing = false;
	$effect(() => {
		const compressing = isCompressing;
		if (compressing) {
			done.clear();
		} else if (prevCompressing && !hasError) {
			done.trigger();
			pulse(btnEl);
		}
		prevCompressing = compressing;
	});
</script>

<!-- The action row — black pill CTA; Cancel joins as a sibling pill while
     running, `children` (Download All as ZIP) once results exist. On phones a
     wide child wraps to its own full-width line (max-sm:min-w-full there). -->
<div class="flex flex-wrap items-stretch gap-2 p-4 sm:px-5">
	<button
		bind:this={btnEl}
		data-testid="compress-cta"
		onclick={oncompress}
		disabled={disabled || isCompressing}
		class="flex h-14 min-w-0 flex-1 items-center justify-center gap-2 rounded-full px-6 text-[15px] font-medium transition-colors duration-300 disabled:cursor-not-allowed disabled:opacity-40 {done.current
			? 'bg-ok-solid text-white'
			: secondary
				? 'text-ink ring-1 ring-line-strong hover:bg-card-2'
				: 'bg-ink text-ink-contrast hover:bg-ink/90'}"
		{@attach pressable()}
	>
		{#if isCompressing}
			<Spinner class="size-4" />
			{busyLabel}
		{:else if done.current}
			<Icon name="check" class="icon-draw size-4" />
			Done
		{:else}
			{label}
		{/if}
	</button>
	{#if isCompressing && oncancel}
		<button
			transition:fade={{ duration: 150 }}
			onclick={oncancel}
			class="h-14 shrink-0 rounded-full bg-card-2 px-6 text-[15px] font-medium text-muted transition-colors hover:text-ink"
			{@attach pressable()}
		>
			Cancel
		</button>
	{/if}
	{@render children?.()}
</div>
