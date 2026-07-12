<script lang="ts">
	import type { ZipSettings } from '$lib/types';
	import Pill from './Pill.svelte';

	interface Props {
		settings: ZipSettings;
	}

	let { settings = $bindable() }: Props = $props();

	const levels: { id: ZipSettings['level']; label: string; hint: string }[] = [
		{ id: 0, label: 'Store', hint: 'No compression — fastest' },
		{ id: 1, label: 'Fast', hint: 'Light compression' },
		{ id: 6, label: 'Balanced', hint: 'The usual default' },
		{ id: 9, label: 'Max', hint: 'Smallest, slowest' }
	];
</script>

{#if settings.op === 'create'}
	<div>
		<p class="microlabel text-muted">Compression level</p>
		<div class="mt-2.5 flex flex-wrap gap-2">
			{#each levels as level (level.id)}
				<Pill active={settings.level === level.id} onclick={() => (settings.level = level.id)}>
					{level.label}
				</Pill>
			{/each}
		</div>
		<p class="mt-2 hint text-faint">
			{levels.find((l) => l.id === settings.level)?.hint}. Already-compressed files (photos, video)
			barely shrink at any level.
		</p>
		<p class="mt-2 hint text-faint">All listed files land in one archive.zip, names kept.</p>
	</div>
{:else}
	<p class="text-xs text-faint">
		Every file inside the archive becomes its own row — download them individually or all at once.
	</p>
{/if}
