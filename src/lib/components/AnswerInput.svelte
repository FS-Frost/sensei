<script lang="ts">
	import { bind, unbind } from 'wanakana';
	import type { AnswerMode } from '../types.ts';

	let {
		value = $bindable(''),
		mode,
		disabled = false,
		status = 'idle',
		onsubmit,
		placeholder
	}: {
		value?: string;
		mode: AnswerMode;
		disabled?: boolean;
		status?: 'idle' | 'ok' | 'bad' | 'warn';
		onsubmit: () => void;
		placeholder?: string;
	} = $props();

	let el: HTMLInputElement | undefined = $state();

	// Romaji → kana en vivo solo en lecturas.
	$effect(() => {
		if (!el || mode !== 'kana') return;
		const node = el;
		bind(node, { IMEMode: 'toHiragana' });
		return () => unbind(node);
	});

	$effect(() => {
		if (!disabled) el?.focus();
	});

	const defaultPlaceholder = $derived(
		mode === 'kana' ? 'Lectura (escribe en romaji → かな)' : mode === 'romaji' ? 'Romaji' : 'Significado en español'
	);

	function onkeydown(e: KeyboardEvent) {
		if (e.key === 'Enter') {
			e.preventDefault();
			// wanakana reescribe el valor del input: sincronizar antes de enviar.
			if (el) value = el.value;
			onsubmit();
		}
	}
</script>

<input
	bind:this={el}
	bind:value
	class="answer {status} {mode === 'kana' ? 'jp' : ''}"
	{disabled}
	{onkeydown}
	placeholder={placeholder ?? defaultPlaceholder}
	autocomplete="off"
	autocapitalize="off"
	spellcheck="false"
	lang={mode === 'kana' ? 'ja' : 'es'}
/>

<style>
	.answer {
		font-size: 1.3rem;
		text-align: center;
		padding: 0.8rem;
	}
	.answer.ok {
		border-color: var(--ok);
		background: color-mix(in srgb, var(--ok) 12%, var(--bg));
	}
	.answer.bad {
		border-color: var(--bad);
		background: color-mix(in srgb, var(--bad) 12%, var(--bg));
	}
	.answer.warn {
		border-color: var(--warn);
	}
</style>
