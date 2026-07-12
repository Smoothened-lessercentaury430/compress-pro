<script lang="ts">
	import type { SvgCompressionSettings } from '$lib/types';

	interface Props {
		settings: SvgCompressionSettings;
	}

	let { settings = $bindable() }: Props = $props();
</script>

<div class="space-y-4">
	<div class="divide-y divide-line">
		<label class="flex items-center justify-between gap-3 py-2.5">
			<span class="microlabel text-muted">Remove comments</span>
			<input type="checkbox" class="switch" bind:checked={settings.removeComments} />
		</label>
		<label class="flex items-center justify-between gap-3 py-2.5">
			<span class="microlabel text-muted">Remove metadata</span>
			<input type="checkbox" class="switch" bind:checked={settings.removeMetadata} />
		</label>
		<label class="flex items-center justify-between gap-3 py-2.5">
			<span class="microlabel text-muted">Clean up IDs</span>
			<input type="checkbox" class="switch" bind:checked={settings.cleanupIds} />
		</label>
		<label class="flex items-center justify-between gap-3 py-2.5">
			<span class="microlabel text-muted">Remove dimensions (keep viewBox)</span>
			<input type="checkbox" class="switch" bind:checked={settings.removeDimensions} />
		</label>
		<label class="flex items-center justify-between gap-3 py-2.5">
			<span class="microlabel text-muted">Aggressive optimizations</span>
			<input type="checkbox" class="switch" bind:checked={settings.aggressive} />
		</label>
	</div>
	{#if settings.aggressive}
		<p class="hint text-faint">
			Extra passes: deeper cleanup of styles, hidden shapes and duplicates. Safe for static SVGs;
			may affect scripted or animated files.
		</p>
	{/if}
</div>
