<script lang="ts">
	interface Props {
		/** Size/margin/color utility classes; the spin animation is built in. */
		class?: string;
		/** Accessible name; omitted → the spinner is decorative (aria-hidden). */
		label?: string;
	}

	let { class: className = 'size-4', label }: Props = $props();
</script>

<svg
	class="animate-spin {className}"
	viewBox="0 0 24 24"
	fill="none"
	role={label ? 'img' : undefined}
	aria-label={label}
	aria-hidden={label ? undefined : true}
>
	<circle class="opacity-25" cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.75" />
	<path
		class="opacity-75"
		d="M3 12a9 9 0 0 1 18 0"
		stroke="currentColor"
		stroke-width="1.75"
		stroke-linecap="round"
	/>
</svg>
