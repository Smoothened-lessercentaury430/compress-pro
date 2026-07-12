<script lang="ts">
	import { theme } from '$lib/stores/theme.svelte';
	import { iconSpin } from '$lib/motion/transitions';
	import { pressable } from '$lib/motion/gestures';
	import Icon from './Icon.svelte';

	let icon: 'moon' | 'monitor' | 'sun' = $derived(
		theme.resolved === 'dark' ? 'moon' : theme.mode === 'system' ? 'monitor' : 'sun'
	);
</script>

<button
	onclick={() => theme.cycle()}
	class="grid size-10 place-items-center rounded-full text-muted transition-colors hover:bg-card/80 hover:text-ink hover:backdrop-blur-xs dark:hover:bg-card-2/80"
	aria-label="Toggle theme ({theme.mode})"
	title="Theme: {theme.mode}"
	{@attach pressable()}
>
	<span class="relative size-5">
		{#key icon}
			<span class="absolute inset-0" in:iconSpin={{ from: -90 }} out:iconSpin={{ from: 90 }}>
				<Icon name={icon} class="icon-theme size-5" />
			</span>
		{/key}
	</span>
</button>
