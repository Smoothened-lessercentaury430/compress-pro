<script lang="ts">
	import type { Snippet } from 'svelte';
	import Icon from '../Icon.svelte';

	interface Props {
		open: boolean;
		/** Shown on the collapsed toggle row — a persisted advanced setting
		 *  (e.g. the resize preset's dimension cap) must never act invisibly. */
		summary?: string | null;
		children: Snippet;
	}

	let { open = $bindable(), summary = null, children }: Props = $props();
</script>

<!-- Secondary settings, collapsed by default. Content stays MOUNTED when
     closed (grid-rows collapse, not {#if}) — e2e asserts input values on the
     collapsed section (LP-04) and persisted-settings binds must stay live.
     e2e opens it via data-testid="advanced-toggle" (helpers.openAdvanced). -->
<!-- Gray drawer: the tint covers the toggle row AND the open content, so the
     whole zone reads as one sub-level of the card (flat — no hairline). -->
<div class="bg-card-2/40">
	<button
		type="button"
		data-testid="advanced-toggle"
		aria-expanded={open}
		aria-controls="advanced-options"
		onclick={() => (open = !open)}
		class="flex w-full items-center justify-between gap-4 px-4 py-3.5 text-left transition-colors hover:bg-card-2/80 sm:px-5"
	>
		<span class="microlabel text-muted">
			Advanced options{#if !open && summary}<span class="text-ink"> · {summary}</span>{/if}
		</span>
		<Icon
			name="chevron-down"
			class="size-4 shrink-0 text-faint transition-transform duration-300 {open
				? 'rotate-180'
				: ''}"
		/>
	</button>
	<div
		class="grid transition-[grid-template-rows] duration-300 ease-[var(--ease-swift)] motion-reduce:transition-none {open
			? 'grid-rows-[1fr]'
			: 'grid-rows-[0fr]'}"
		inert={!open}
	>
		<div
			class="overflow-hidden transition-opacity duration-300 motion-reduce:transition-none {open
				? 'opacity-100'
				: 'opacity-0'}"
		>
			<div id="advanced-options" role="region" aria-label="Advanced settings" class="panel-grid">
				{@render children()}
			</div>
		</div>
	</div>
</div>
