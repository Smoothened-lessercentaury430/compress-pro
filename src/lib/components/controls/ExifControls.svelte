<script lang="ts">
	import type { ExifSettings } from '$lib/types';

	interface Props {
		settings: ExifSettings;
	}

	let { settings = $bindable() }: Props = $props();
</script>

<div class="space-y-2">
	<p class="microlabel text-muted">What gets removed</p>
	<p class="text-xs text-muted">
		Always removed: EXIF · GPS location · XMP · comments · text chunks
	</p>
	<p class="hint text-faint">
		Lossless — hidden data is cut out without touching the image itself; pixels stay identical.
		Orientation is preserved so photos never turn sideways.
	</p>
</div>

<div class="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4">
	<label for="remove-icc" class="microlabel cursor-pointer sm:self-end text-muted"
		>Also remove color profile</label
	>
	<input
		id="remove-icc"
		type="checkbox"
		class="switch row-span-2 justify-self-end max-sm:row-span-1"
		bind:checked={settings.removeIcc}
	/>
	{#if settings.removeIcc}
		<p class="mt-0.5 hint text-faint sm:self-start max-sm:col-span-2">
			The ICC profile affects how colors render — wide-gamut photos may look slightly different
			without it.
		</p>
	{/if}
</div>
