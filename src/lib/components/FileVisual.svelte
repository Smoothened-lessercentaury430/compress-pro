<script lang="ts">
	import { fileVisual } from '$lib/file-visual';
	import Icon from './Icon.svelte';

	interface Props {
		name: string;
		objectUrl: string;
	}

	let { name, objectUrl }: Props = $props();
	let visual = $derived(fileVisual(name));
</script>

<!-- The row's leading tile: real thumbnail for displayable images, a tinted
     family glyph for known formats, an extension microlabel for the rest.
     Glyphs/labels stay decorative (no img role) — e2e pins rows' role=img
     queries to the "Done" status icon only. -->
{#if visual.kind === 'thumb'}
	<div class="size-10 shrink-0 overflow-hidden rounded-lg bg-card-2 ring-1 ring-line">
		<img src={objectUrl} alt={name} class="h-full w-full object-cover" />
	</div>
{:else if visual.kind === 'icon'}
	<div class="grid size-10 shrink-0 place-items-center rounded-lg bg-card-2">
		<Icon name={visual.icon} class="size-5 {visual.tint}" />
	</div>
{:else}
	<div class="grid size-10 shrink-0 place-items-center rounded-lg bg-card-2">
		<span class="microlabel {visual.tint}" aria-hidden="true">{visual.label}</span>
	</div>
{/if}
