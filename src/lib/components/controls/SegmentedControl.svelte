<script lang="ts">
	import { slideIndicator } from '$lib/motion/indicator.svelte';

	interface Props {
		items: { id: string; label: string }[];
		selected: string;
		onselect: (id: string) => void;
		/** Shrink-wrap: content-sized equal columns (label-top cells). */
		fit?: boolean;
	}

	let { items, selected, onselect, fit = false }: Props = $props();
</script>

<div
	class="relative grid gap-1 rounded-full bg-card-2 p-1 {fit ? 'w-fit max-w-full' : ''}"
	style:grid-template-columns={`repeat(${items.length}, minmax(0, 1fr))`}
	{@attach slideIndicator(() => selected)}
>
	<span
		data-thumb
		aria-hidden="true"
		class="absolute inset-y-1 left-0 w-0 rounded-full bg-ink opacity-0"
	></span>
	{#each items as item (item.id)}
		<!-- no text-transform: e2e reads these via data-seg, but labels stay readable -->
		<button
			type="button"
			data-seg={item.id}
			aria-pressed={selected === item.id}
			class="relative rounded-full px-3 py-2 font-mono text-xs font-medium transition-colors duration-300 max-sm:py-2.5 {selected ===
			item.id
				? 'bg-ink text-ink-contrast in-data-ready:bg-transparent'
				: 'text-muted hover:text-ink'}"
			onclick={() => onselect(item.id)}
		>
			{item.label}
		</button>
	{/each}
</div>
