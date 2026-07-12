<script lang="ts">
	interface Props {
		id: string;
		label: string;
		value: number;
		min?: number;
		max?: number;
		step?: number;
		/** Readout suffix: '%' renders tight ("80%"); anything else as a small muted word ("3 decimals"). */
		unit?: string;
		/** Secondary readout on the label row, e.g. "est ~35.6 MB". Never contains the value+unit pair. */
		detail?: string | null;
	}

	let {
		id,
		label,
		value = $bindable(),
		min = 0,
		max = 100,
		step = 1,
		unit = '%',
		detail = null
	}: Props = $props();

	// Pressed/dragged — drives the glass-lens state purely via CSS ([data-grabbed]).
	// Pointer events instead of :active: iOS Safari doesn't hold :active through a
	// whole touch drag, and keyboard use must not inflate the thumb.
	let grabbed = $state(false);

	// Thumb position along the track, 0–1; toFixed(4) keeps SSR/CSR markup identical.
	let fraction = $derived(
		max > min ? Math.min(1, Math.max(0, (value - min) / (max - min))).toFixed(4) : '0'
	);
</script>

<svelte:window onpointerup={() => (grabbed = false)} onpointercancel={() => (grabbed = false)} />

<div data-slider style="--f: {fraction}">
	<div class="mb-2 flex items-baseline justify-between gap-3">
		<label for={id} class="microlabel text-muted">{label}</label>
		<span class="flex min-w-0 items-baseline gap-3">
			{#if detail}
				<span class="microlabel truncate text-faint">{detail}</span>
			{/if}
			<!-- The {value}% pair must stay one text run — e2e reads it back verbatim -->
			<span class="font-mono text-2xl font-medium tracking-tight text-ink tabular-nums">
				{#if unit === '%'}
					{value}%
				{:else}
					{value}
					<span class="font-mono text-[11px] font-medium text-muted">{unit}</span>
				{/if}
			</span>
		</span>
	</div>
	<div class="slider-zone" data-grabbed={grabbed ? '' : undefined}>
		<div class="slider-track"><div class="slider-fill"></div></div>
		<!-- min/max before bind:value so the initial value is never clamped against the default max -->
		<input
			{id}
			type="range"
			{min}
			{max}
			{step}
			bind:value
			class="slider-input"
			onpointerdown={() => (grabbed = true)}
		/>
		<div class="slider-thumb"></div>
	</div>
</div>
