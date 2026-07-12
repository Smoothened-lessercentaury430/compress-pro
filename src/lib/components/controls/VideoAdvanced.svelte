<script lang="ts">
	import type { VideoConversionSettings } from '$lib/types';
	import SegmentedControl from './SegmentedControl.svelte';

	interface Props {
		settings: VideoConversionSettings;
	}

	let { settings = $bindable() }: Props = $props();

	const videoFps = [
		{ id: 'original', label: 'Original' },
		{ id: '60', label: '60 fps' },
		{ id: '30', label: '30 fps' }
	];
	// GIF frames are expensive — the sensible range is far below video rates.
	const gifFps = [
		{ id: '15', label: '15 fps' },
		{ id: '10', label: '10 fps' },
		{ id: '5', label: '5 fps' }
	];

	let isGif = $derived(settings.container === 'gif');
	let fpsOptions = $derived(isGif ? gifFps : videoFps);
</script>

<div class="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4">
	<label for="max-dimension" class="microlabel sm:self-end text-muted">Max dimension</label>
	<div class="relative row-span-2 justify-self-end max-sm:row-span-1">
		<input
			id="max-dimension"
			type="number"
			min="1"
			max="65535"
			step="1"
			placeholder="1280"
			bind:value={settings.maxDimension}
			class="h-10 w-28 rounded-field border border-line-strong bg-card pr-9 pl-3 text-right font-mono text-base text-ink transition-colors tabular-nums placeholder:text-faint focus-visible:border-accent sm:text-sm"
		/>
		<span
			class="microlabel pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-faint"
			>px</span
		>
	</div>
	<p class="mt-0.5 hint text-faint sm:self-start max-sm:col-span-2">
		Optional. Longest side — larger videos are downscaled before encoding; smaller ones are left
		as-is.
	</p>
</div>

<div>
	<p class="microlabel text-muted">Frame rate</p>
	<div class="mt-2.5">
		<SegmentedControl
			fit
			items={fpsOptions}
			selected={String(settings.fps)}
			onselect={(id) =>
				(settings.fps = (
					id === 'original' ? 'original' : Number(id)
				) as VideoConversionSettings['fps'])}
		/>
	</div>
	<p class="mt-2 hint text-faint">
		{isGif
			? 'Frames per second of the GIF — 10–15 looks smooth, 5 is tiny.'
			: 'Caps only — lower frame rates mean smaller files.'}
	</p>
</div>

{#if !isGif}
	<label class="flex items-center justify-between gap-3">
		<span class="microlabel text-muted">Remove audio</span>
		<input type="checkbox" class="switch" bind:checked={settings.removeAudio} />
	</label>
{/if}
