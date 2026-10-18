<script lang="ts">
	import { toast } from '#lib/client/toast.svelte.ts';
	import HelpLink from '#lib/components/HelpLink.svelte';
	import { post, errMsg } from '#lib/client/api.ts';
	import type { JpToken } from '#lib/types.ts';
	import JpTokens from '#lib/components/JpTokens.svelte';
	import SpeakButton from '#lib/components/SpeakButton.svelte';
	import AddWordButton from '#lib/components/AddWordButton.svelte';
	import MineSentence from '#lib/components/MineSentence.svelte';
	import { setScreenContext } from '#lib/client/tutorContext.svelte.ts';
	import CostNote from '#lib/components/CostNote.svelte';
	import type { OperationCost } from '#lib/cost.ts';
	import { onMount } from 'svelte';
	import { takePending } from '#lib/client/inbox.ts';
	import CameraCapture from '#lib/components/CameraCapture.svelte';

	// Llegó compartido hacia Sensei (/compartir): texto o imagen listos para explicar.
	onMount(() => {
		const p = takePending('explicar');
		if (!p) return;
		if (p.text) text = p.text;
		if (p.files[0]) pick(p.files[0]).catch((err) => toast.error('No se pudo explicar', { detail: errMsg(err) }));
	});

	type Explanation = {
		transcription: string;
		sentences: {
			tokens: JpToken[];
			es: string;
			grammar: { pattern: string; explanation: string; id?: string; studied?: boolean }[];
		}[];
		notes: string;
	};

	$effect(() => {
		if (!result) return;
		setScreenContext({
			kind: 'explain',
			label: 'texto explicado',
			data: {
				text: result.sentences.map((x) => x.tokens.map((t) => t.s).join('')).join('').slice(0, 800),
				translation: result.sentences.map((x) => x.es).join(' ').slice(0, 800),
				grammar: result.sentences.flatMap((x) => x.grammar.map((g) => g.pattern)).slice(0, 12)
			}
		});
	});

	let learned: Record<string, boolean> = $state({});
	async function learnGrammar(id: string) {
		try {
			await post('/api/srs/add', { grammar: id });
			learned[id] = true;
		} catch (e) {
			toast.error('No se pudo explicar', { detail: errMsg(e) });
		}
	}

	let text = $state('');
	let image = $state<{ mimeType: string; data: string; url: string } | null>(null);
	let result = $state<Explanation | null>(null);
	let cost = $state<OperationCost | null>(null);
	let loading = $state(false);
	let fileInput: HTMLInputElement | undefined = $state();
	let cameraInput: HTMLInputElement | undefined = $state();
	let cameraOpen = $state(false);
	// Móvil (pantalla táctil sin ratón): la app de cámara del sistema, que abre la trasera con capture="environment".
	// Si no, la cámara dentro de la app (si el navegador la permite).
	let mobile = $state(false);
	let canCamera = $state(false);
	onMount(() => {
		mobile = matchMedia('(pointer: coarse) and (hover: none)').matches;
		canCamera = mobile || !!navigator.mediaDevices?.getUserMedia;
	});
	function openCamera() {
		if (mobile) cameraInput?.click();
		else cameraOpen = true;
	}

	const MAX = 1600; // px del lado mayor tras reducir

	async function pick(file: File) {
		// Reducir la imagen en el navegador: menos datos y menos tokens.
		const bmp = await createImageBitmap(file);
		const scale = Math.min(1, MAX / Math.max(bmp.width, bmp.height));
		const canvas = document.createElement('canvas');
		canvas.width = Math.round(bmp.width * scale);
		canvas.height = Math.round(bmp.height * scale);
		canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
		const url = canvas.toDataURL('image/jpeg', 0.88);
		image = { mimeType: 'image/jpeg', data: url.split(',')[1], url };
	}

	function onfile(e: Event) {
		const f = (e.target as HTMLInputElement).files?.[0];
		(e.target as HTMLInputElement).value = ''; // poder elegir/hacer la misma foto otra vez
		if (f) pick(f).catch((err) => toast.error('No se pudo explicar', { detail: errMsg(err) }));
	}

	function onpaste(e: ClipboardEvent) {
		const f = [...(e.clipboardData?.files ?? [])].find((x) => x.type.startsWith('image/'));
		if (f) {
			e.preventDefault();
			pick(f).catch((err) => toast.error('No se pudo explicar', { detail: errMsg(err) }));
		}
	}

	async function explain() {
		if (!text.trim() && !image) return;
		loading = true;
		result = null;
		try {
			const r = await post<{ explanation: Explanation; cost: OperationCost | null }>('/api/explain', {
				text: text.trim() || undefined,
				image: image ? { mimeType: image.mimeType, data: image.data } : undefined
			});
			result = r.explanation;
			cost = r.cost;
		} catch (e) {
			toast.error('No se pudo explicar', { detail: errMsg(e) });
		} finally {
			loading = false;
		}
	}

	const words = $derived(
		result
			? [
					...new Map(
						result.sentences
							.flatMap((s) => s.tokens)
							.filter((t) => t.g && t.p !== 'puntuación' && t.p !== 'partícula' && t.p !== 'auxiliar')
							.map((t) => [t.b ?? t.s, t])
					).values()
				]
			: []
	);
	const plain = (tokens: JpToken[]) => tokens.map((t) => t.s).join('');
</script>

<svelte:window {onpaste} />
<CameraCapture bind:open={cameraOpen} oncapture={(f) => pick(f).catch((err) => toast.error('No se pudo usar la foto', { detail: errMsg(err) }))} />
<svelte:head><title>Explicador · Sensei</title></svelte:head>

<h1>Explicador <HelpLink section="explicar" /></h1>
<p class="muted small">Pega texto japonés, sube o pega una captura, o hazle una foto con la cámara (manga, juego, cartel). El tutor lo transcribe y lo desglosa.</p>

<div class="card stack">
	<textarea bind:value={text} rows="3" class="jp" placeholder="Pega aquí el texto japonés…"></textarea>
	<div class="row">
		<input type="file" accept="image/*" bind:this={fileInput} onchange={onfile} hidden />
		<!-- En el móvil, la cámara nativa (trasera); en PC/tablet, la cámara dentro de la app. -->
		<input type="file" accept="image/*" capture="environment" bind:this={cameraInput} onchange={onfile} hidden />
		<button onclick={() => fileInput?.click()}>🖼 Subir imagen</button>
		{#if canCamera}<button onclick={openCamera}>📸 Cámara</button>{/if}
		{#if image}
			<img src={image.url} alt="Imagen a explicar" class="thumb" />
			<button class="small ghost" onclick={() => (image = null)}>Quitar</button>
		{/if}
		<span class="grow"></span>
		<button class="primary" onclick={explain} disabled={loading || (!text.trim() && !image)}>
			{#if loading}<span class="spinner"></span> Analizando…{:else}Explicar{/if}
		</button>
	</div>
</div>


{#if result}
	<CostNote {cost} />
	{#if image}<div class="card small"><strong>Transcripción:</strong> <span class="jp">{result.transcription}</span></div>{/if}
	{#each result.sentences as s, i (i)}
		<div class="card stack">
			<div class="sentence">
				<JpTokens tokens={s.tokens} />
				<SpeakButton text={plain(s.tokens)} />
			</div>
			<div class="spread">
				<div>{s.es}</div>
				<MineSentence tokens={s.tokens} es={s.es} source="explain" />
			</div>
			<table class="tokens small">
				<tbody>
					{#each s.tokens.filter((t) => t.p !== 'puntuación') as t, ti (ti)}
						<tr>
							<td class="jp tk" class:unverified={t.v === false}>{t.s}</td>
							<td class="jp muted">{t.r ?? ''}</td>
							<td class="jp dim">{t.b && t.b !== t.s ? t.b : ''}</td>
							<td class="dim">{t.p ?? ''}</td>
							<td>{t.g ?? ''}</td>
						</tr>
					{/each}
				</tbody>
			</table>
			{#if s.grammar.length}
				<div class="grammar">
					{#each s.grammar as g (g.pattern)}
						<div>
							<strong class="jp">{g.pattern}</strong> — {g.explanation}
							{#if g.id && !g.studied && !learned[g.id]}
								<button class="small" onclick={() => learnGrammar(g.id!)} title="Añadir este punto a tu pista de gramática">
									＋ Aprender este punto
								</button>
							{:else if g.id && (g.studied || learned[g.id])}
								<span class="small muted">✓ en tu gramática</span>
							{/if}
						</div>
					{/each}
				</div>
			{/if}
		</div>
	{/each}
	{#if result.notes}<div class="card small muted">{result.notes}</div>{/if}

	{#if words.length}
		<div class="card">
			<h3>Añadir palabras al SRS</h3>
			<ul class="words">
				{#each words as w (w.b ?? w.s)}
					<li>
						<span class="jp">{w.b ?? w.s}</span>
						{#if w.r}<span class="jp muted">【{w.r}】</span>{/if}
						<span class="small">{w.g}</span>
						<AddWordButton word={w.s} base={w.b} reading={w.r} gloss={w.g} />
					</li>
				{/each}
			</ul>
			<p class="dim small">Las lecturas con subrayado punteado no coinciden con el diccionario: verifícalas.</p>
		</div>
	{/if}
{/if}

<style>
	.thumb {
		height: 56px;
		border-radius: 6px;
		border: 1px solid var(--line);
	}
	.grow {
		flex: 1;
	}
	.sentence {
		font-size: 1.4rem;
		display: flex;
		align-items: center;
		flex-wrap: wrap;
	}
	.tokens {
		border-collapse: collapse;
		width: 100%;
	}
	.tokens td {
		padding: 0.2rem 0.6rem 0.2rem 0;
		border-bottom: 1px solid var(--line);
		vertical-align: top;
	}
	.tk {
		font-size: 1.05rem;
	}
	.grammar {
		border-left: 3px solid var(--vocab);
		padding-left: 0.8rem;
		display: grid;
		gap: 0.3rem;
	}
	.words {
		list-style: none;
		padding: 0;
		margin: 0;
		display: grid;
		gap: 0.35rem;
	}
	@media (max-width: 600px) {
		.tokens td:nth-child(3),
		.tokens td:nth-child(4) {
			display: none;
		}
	}
</style>
