<script lang="ts">
	import type { ProgressInfo } from '$lib/types';
	import { fade } from 'svelte/transition';
	import AnimatedNumber from './AnimatedNumber.svelte';
	import { progressFill } from '$lib/motion/progress.svelte';
	import { reveal } from '$lib/motion/reveal';
	import { pressable } from '$lib/motion/gestures';

	interface Props {
		progress: number;
		visible: boolean;
		info?: ProgressInfo | null;
		/** Completed / total counts — files run in parallel, so "File i/N" lies. */
		filesDone?: number;
		fileCount?: number;
		/** Smoothed seconds remaining; null hides the estimate. */
		etaSeconds?: number | null;
		/** Files already finished this run — enables the mid-run ZIP download. */
		finishedCount?: number;
		ondownloadfinished?: () => void;
	}

	let {
		progress,
		visible,
		info = null,
		filesDone = 0,
		fileCount = 0,
		etaSeconds = null,
		finishedCount = 0,
		ondownloadfinished
	}: Props = $props();

	let fileLabel = $derived(
		info
			? `${fileCount > 1 ? `${filesDone}/${fileCount} done — ` : ''}${info.fileName}`
			: 'Processing…'
	);

	function formatEta(seconds: number): string {
		if (seconds < 60) return `~${Math.max(5, Math.round(seconds / 5) * 5)}s left`;
		return `~${Math.ceil(seconds / 60)} min left`;
	}
</script>

{#if visible}
	<div class="p-4 sm:px-5" {@attach reveal({ y: 6 })}>
		<div class="flex items-baseline justify-between gap-4">
			<div class="min-w-0 flex-1 text-xs text-muted {progress === 0 ? 'animate-pulse' : ''}">
				{#key info?.fileIndex}
					<span class="block truncate" in:fade={{ duration: 120 }}>
						{fileLabel}{#if info?.detail}<span class="text-faint"> — {info.detail}</span>{/if}
					</span>
				{/key}
			</div>
			<div class="shrink-0 text-right">
				<AnimatedNumber
					class="font-mono text-2xl font-medium tracking-tight text-ink tabular-nums"
					value={progress * 100}
					format={(n) => `${Math.round(n)}%`}
				/>
				{#if etaSeconds != null}
					<p
						class="font-mono text-[10px] text-faint tabular-nums"
						transition:fade={{ duration: 150 }}
					>
						{formatEta(etaSeconds)}
					</p>
				{/if}
			</div>
		</div>
		<div
			class="mt-3 h-2 overflow-hidden rounded-full bg-card-2"
			role="progressbar"
			aria-valuemin={0}
			aria-valuemax={100}
			aria-valuenow={Math.round(progress * 100)}
			aria-valuetext="{Math.round(progress * 100)}% — {fileLabel}"
		>
			<div
				class="progress-sheen relative h-full w-full overflow-hidden bg-accent"
				{@attach progressFill(() => progress)}
			></div>
		</div>
		<!-- lives here, NOT inside a file row — e2e Download locators are row-scoped -->
		{#if finishedCount > 0 && ondownloadfinished}
			<div class="mt-3.5 flex justify-end" transition:fade={{ duration: 150 }}>
				<button
					type="button"
					class="rounded-full px-3 py-1 text-xs font-medium text-muted ring-1 ring-line transition-colors hover:text-ink"
					onclick={ondownloadfinished}
					{@attach pressable()}
				>
					Download finished ({finishedCount})
				</button>
			</div>
		{/if}
	</div>
{/if}
