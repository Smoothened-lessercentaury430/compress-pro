<script lang="ts">
	import type { FileFormat, ImageCompressionSettings } from '$lib/types';

	interface Props {
		format: FileFormat;
		settings: ImageCompressionSettings;
	}

	let { format, settings = $bindable() }: Props = $props();
</script>

<div class="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4">
	<label for="max-dimension" class="microlabel sm:self-end text-muted">Max dimension</label>
	<div class="relative row-span-2 justify-self-end max-sm:row-span-1">
		<input
			id="max-dimension"
			type="number"
			inputmode="numeric"
			min="1"
			max="65535"
			step="1"
			placeholder="1920"
			bind:value={settings.maxDimension}
			class="h-10 w-28 rounded-field border border-line-strong bg-card pr-9 pl-3 text-right font-mono text-base text-ink transition-colors tabular-nums placeholder:text-faint focus-visible:border-accent sm:text-sm"
		/>
		<span
			class="microlabel pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-faint"
			>px</span
		>
	</div>
	<p class="mt-0.5 hint text-faint sm:self-start max-sm:col-span-2">
		Optional. Longest side — larger images are downscaled before compression; smaller ones are left
		as-is.
	</p>
</div>
{#if format !== 'gif'}
	<div class="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4">
		<label for="keep-metadata" class="microlabel cursor-pointer sm:self-end text-muted"
			>Keep metadata</label
		>
		<input
			id="keep-metadata"
			type="checkbox"
			class="switch row-span-2 justify-self-end max-sm:row-span-1"
			bind:checked={settings.keepMetadata}
		/>
		<p class="mt-0.5 hint text-faint sm:self-start max-sm:col-span-2">
			Keeps EXIF (date, camera, GPS) in JPG, PNG and WebP outputs. Color profiles are not copied —
			output is sRGB.
		</p>
	</div>
{/if}
