<script lang="ts">
	import type { SvgCompressionSettings } from '$lib/types';
	import Slider from '../Slider.svelte';
	import Pill from './Pill.svelte';

	interface Props {
		settings: SvgCompressionSettings;
	}

	let { settings = $bindable() }: Props = $props();

	const svgOutputs: { id: SvgCompressionSettings['outputFormat']; label: string }[] = [
		{ id: 'svg', label: 'SVG' },
		{ id: 'png', label: 'PNG' },
		{ id: 'ico', label: 'ICO' }
	];
</script>

<!-- The optimization switches live in SvgAdvanced (the Advanced disclosure);
     PNG/ICO render the ORIGINAL vector, so those switches don't apply there. -->
{#if settings.outputFormat === 'svg'}
	<div>
		<Slider
			id="precision"
			label="Precision"
			bind:value={settings.precision}
			min={0}
			max={8}
			unit="decimals"
		/>
		<p class="mt-2 hint text-faint">
			Lower = smaller file, but less precise curves. Default 3 is a good balance.
		</p>
	</div>
{:else if settings.outputFormat === 'png'}
	<div>
		<Slider id="quality" label="Quality" bind:value={settings.quality} min={1} max={100} />
		<p class="mt-2 hint text-faint">
			{settings.quality < 100
				? 'Lossy PNG: fewer colors, much smaller file. 100 = lossless.'
				: 'Lossless PNG — the rendered pixels stay exactly as drawn.'}
		</p>
	</div>
	<div>
		<div class="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4">
			<label for="raster-size" class="microlabel sm:self-end text-muted">Size</label>
			<div class="relative row-span-2 justify-self-end max-sm:row-span-1">
				<input
					id="raster-size"
					type="number"
					inputmode="numeric"
					min="16"
					max="4096"
					step="1"
					placeholder="1024"
					bind:value={settings.rasterSize}
					class="h-10 w-28 rounded-field border border-line-strong bg-card pr-9 pl-3 text-right font-mono text-base text-ink transition-colors tabular-nums placeholder:text-faint focus-visible:border-accent sm:text-sm"
				/>
				<span
					class="microlabel pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-faint"
					>px</span
				>
			</div>
			<p class="mt-0.5 hint text-faint sm:self-start max-sm:col-span-2">
				Longest side of the rendered PNG — vector art stays sharp at any size.
			</p>
		</div>
	</div>
{/if}
<div>
	<p class="microlabel text-muted">Output format</p>
	<div class="mt-2.5 flex flex-wrap gap-2">
		{#each svgOutputs as fmt (fmt.id)}
			<Pill
				active={settings.outputFormat === fmt.id}
				onclick={() => (settings.outputFormat = fmt.id)}
			>
				{fmt.label}
			</Pill>
		{/each}
	</div>
	{#if settings.outputFormat === 'ico'}
		<p class="mt-2 hint text-faint">
			Multi-size favicon ICO (16–256 px in one file) — every size is encoded lossless, transparency
			is kept, and non-square images are centered.
		</p>
	{:else if settings.outputFormat === 'png'}
		<p class="mt-2 hint text-faint">
			Rendered from the vector at the size you set — transparency is kept.
		</p>
	{/if}
</div>
