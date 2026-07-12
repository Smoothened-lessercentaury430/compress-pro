<script lang="ts">
	import type { PdfCompressionSettings } from '$lib/types';
	import { validatePageRangeSyntax } from '$lib/pdf-range';
	import SegmentedControl from './SegmentedControl.svelte';
	import Pill from './Pill.svelte';
	import Slider from '../Slider.svelte';

	interface Props {
		settings: PdfCompressionSettings;
	}

	let { settings = $bindable() }: Props = $props();

	const pdfModes = [
		{ id: 'level', label: 'Preset level' },
		{ id: 'target', label: 'Target size' }
	];
	const pageModes = [
		{ id: 'keep', label: 'Keep pages' },
		{ id: 'remove', label: 'Remove pages' }
	];
	const pdfImageFormats = [
		{ id: 'jpg', label: 'JPG' },
		{ id: 'png', label: 'PNG' }
	];
	const dpiOptions = [
		{ id: '72', label: '72 DPI' },
		{ id: '150', label: '150 DPI' },
		{ id: '300', label: '300 DPI' }
	];

	let pageRangeError = $derived(
		settings.op === 'pages' ? validatePageRangeSyntax(settings.pageRange) : null
	);
</script>

{#snippet compressBlock()}
	<SegmentedControl
		items={pdfModes}
		selected={settings.mode}
		onselect={(id) => (settings.mode = id as PdfCompressionSettings['mode'])}
	/>

	{#if settings.mode === 'level'}
		<div>
			<p class="microlabel text-muted">Preset level</p>
			<div class="mt-2.5 flex flex-wrap gap-2">
				{#each ['low', 'medium', 'high', 'ultra', 'extreme'] as level (level)}
					<Pill
						active={settings.level === level}
						activeClass={level === 'extreme'
							? 'bg-danger-tint text-danger ring-1 ring-danger/25'
							: level === 'ultra'
								? 'bg-warn-tint text-warn ring-1 ring-warn/25'
								: undefined}
						onclick={() => {
							settings.level = level as PdfCompressionSettings['level'];
						}}
					>
						{level.charAt(0).toUpperCase() + level.slice(1)}
					</Pill>
				{/each}
			</div>
			<p class="mt-2 hint text-faint">
				{#if settings.level === 'extreme'}
					Aggressive: images reduced to ~50 DPI. Significant quality loss — best for archival or
					text-heavy PDFs.
				{:else if settings.level === 'ultra'}
					Heavy: images reduced to ~72 DPI (screen resolution). Noticeable quality loss on detailed
					images.
				{:else}
					Shrinks the images inside and repacks the document. Higher levels = smaller files but
					lower image quality.
				{/if}
			</p>
		</div>
	{:else}
		<div>
			<div class="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4">
				<label for="target-size" class="microlabel sm:self-end text-muted">Target size</label>
				<div class="relative row-span-2 justify-self-end max-sm:row-span-1">
					<input
						id="target-size"
						type="number"
						inputmode="decimal"
						min="0.1"
						max="10000"
						step="0.1"
						bind:value={settings.targetMb}
						class="h-10 w-28 rounded-field border border-line-strong bg-card pr-9 pl-3 text-right font-mono text-base text-ink transition-colors tabular-nums placeholder:text-faint focus-visible:border-accent sm:text-sm"
					/>
					<span
						class="microlabel pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-faint"
						>MB</span
					>
				</div>
				<p class="mt-0.5 hint text-faint sm:self-start max-sm:col-span-2">
					Finds the best quality that still fits under the target (up to 4 compression passes per
					file).
				</p>
			</div>
		</div>
	{/if}
{/snippet}

{#snippet jpgQualitySlider()}
	<Slider
		id="image-quality"
		label="JPG quality"
		bind:value={settings.imageQuality}
		min={1}
		max={100}
	/>
{/snippet}

<div class="space-y-4">
	{#if settings.op === 'compress'}
		{@render compressBlock()}
	{:else if settings.op === 'merge'}
		<p class="hint text-faint">
			Files are merged in the listed order — use the arrows in the list to reorder.
		</p>
		<label class="flex items-center justify-between gap-3 py-1">
			<span class="microlabel text-muted">Compress after merging</span>
			<input type="checkbox" class="switch" bind:checked={settings.mergeCompress} />
		</label>
		{#if settings.mergeCompress}
			{@render compressBlock()}
		{/if}
	{:else if settings.op === 'pages'}
		<SegmentedControl
			items={pageModes}
			selected={settings.pageMode}
			onselect={(id) => (settings.pageMode = id as PdfCompressionSettings['pageMode'])}
		/>
		<div>
			<label for="page-range" class="microlabel mb-2.5 block text-muted">Pages</label>
			<input
				id="page-range"
				type="text"
				placeholder="e.g. 1-3,7,12-"
				bind:value={settings.pageRange}
				class="h-11 w-full rounded-field border border-line-strong bg-card px-4 font-mono text-base text-ink transition-colors tabular-nums placeholder:text-faint focus-visible:border-accent sm:text-sm"
			/>
			<p
				class="hint mt-1.5 {pageRangeError && settings.pageRange.trim()
					? 'text-warn'
					: 'text-faint'}"
			>
				{pageRangeError ?? `Pages to ${settings.pageMode} — ranges and open ends work (1-3,7,12-).`}
			</p>
		</div>
	{:else if settings.op === 'toImages'}
		<SegmentedControl
			items={pdfImageFormats}
			selected={settings.imageFormat}
			onselect={(id) => (settings.imageFormat = id as PdfCompressionSettings['imageFormat'])}
		/>
		<div>
			<p class="microlabel text-muted">Resolution</p>
			<div class="mt-2.5">
				<SegmentedControl
					fit
					items={dpiOptions}
					selected={String(settings.imageDpi)}
					onselect={(id) => (settings.imageDpi = Number(id) as PdfCompressionSettings['imageDpi'])}
				/>
			</div>
			<p class="mt-2 hint text-faint">72 screen · 150 good · 300 print</p>
		</div>
		{#if settings.imageFormat === 'jpg'}
			{@render jpgQualitySlider()}
		{/if}
		<p class="hint text-faint">One page → an image; multi-page PDFs download as a ZIP of images.</p>
	{:else if settings.op === 'unlock' || settings.op === 'protect'}
		<div>
			<label for="pdf-password" class="microlabel mb-2.5 block text-muted">
				{settings.op === 'unlock' ? 'PDF password' : 'Set a password'}
			</label>
			<input
				id="pdf-password"
				type="password"
				autocomplete="off"
				placeholder={settings.op === 'unlock'
					? 'The password that opens the file'
					: 'Choose a password'}
				bind:value={settings.password}
				class="h-11 w-full rounded-field border border-line-strong bg-card px-4 text-base text-ink transition-colors placeholder:text-faint focus-visible:border-accent sm:text-sm"
			/>
			<p class="mt-1.5 hint text-faint">
				The password never leaves your device — everything runs locally.
			</p>
		</div>
		{#if settings.op === 'unlock'}
			<p class="hint text-faint">
				Removes the password so the PDF opens freely. Page content is untouched.
			</p>
		{:else}
			<p class="hint text-faint">
				Standard 128-bit PDF encryption — the same password opens and owns the file.
			</p>
		{/if}
	{:else}
		{@render jpgQualitySlider()}
		<p class="hint text-faint">
			Each image becomes one page (page size = image size), re-encoded as JPEG. Transparency turns
			white; animations keep the first frame. Order with the arrows in the list.
		</p>
	{/if}
</div>
