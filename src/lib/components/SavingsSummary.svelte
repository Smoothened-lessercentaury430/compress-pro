<script lang="ts">
	import type { CompressedFile } from '$lib/types';
	import { formatBytes, formatSignedPercent } from '$lib/utils';
	import AnimatedNumber from './AnimatedNumber.svelte';
	import { reveal, pop } from '$lib/motion/reveal';

	interface Props {
		results: CompressedFile[];
	}

	let { results }: Props = $props();

	let totalOriginal = $derived(results.reduce((s, r) => s + r.originalSize, 0));
	let totalCompressed = $derived(results.reduce((s, r) => s + r.compressedSize, 0));
	let saved = $derived(totalOriginal - totalCompressed);
	let pct = $derived(totalOriginal > 0 ? Math.round((saved / totalOriginal) * 100) : 0);

	const STAT_TWEEN = { duration: 0.8, ease: 'easeOut' };
</script>

<div data-testid="savings-summary" role="status" class="p-4 sm:px-5" {@attach reveal({ y: 6 })}>
	<!-- One compact stat row. e2e readStats reads the values via data-stat. -->
	<div class="flex flex-wrap gap-x-10 gap-y-3">
		<div>
			<p class="microlabel text-muted">Reduction</p>
			<div class="mt-1.5 flex items-baseline gap-x-2">
				<p
					data-stat="reduction"
					class="font-mono text-2xl font-medium tracking-tight tabular-nums {saved >= 0
						? 'text-ok-solid'
						: 'text-danger'}"
				>
					<AnimatedNumber value={pct} format={formatSignedPercent} transition={STAT_TWEEN} />
				</p>
				{#if pct !== 0}
					<span
						class="microlabel shrink-0 whitespace-nowrap {saved >= 0
							? 'text-ok-solid'
							: 'text-danger'}"
						{@attach pop({ delay: 0.4 })}
					>
						{saved >= 0 ? '↓ smaller' : '↑ larger'}
					</span>
				{/if}
			</div>
		</div>
		<div>
			<!-- Conversions can legitimately grow (JPG→ICO, SVG→PNG) — the label
			     must flip with the sign or "saved" would contradict "larger". -->
			<p class="microlabel text-muted">{saved >= 0 ? 'Total saved' : 'Total added'}</p>
			<p
				data-stat="total"
				class="mt-1.5 font-mono text-2xl font-medium tracking-tight text-ink tabular-nums"
			>
				<AnimatedNumber
					value={Math.abs(saved)}
					format={(n) => formatBytes(Math.max(0, Math.round(n)))}
					transition={STAT_TWEEN}
				/>
			</p>
		</div>
		<div>
			<p class="microlabel text-muted">Files</p>
			<p
				data-stat="files"
				class="mt-1.5 font-mono text-2xl font-medium tracking-tight text-ink tabular-nums"
			>
				<AnimatedNumber
					value={results.length}
					format={(n) => `${Math.round(n)}`}
					transition={STAT_TWEEN}
				/>
			</p>
		</div>
	</div>
</div>
