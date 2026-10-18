<script lang="ts">
	import HelpLink from '#lib/components/HelpLink.svelte';
	import { onMount, untrack } from 'svelte';
	import { refreshAll } from '$app/navigation';
	import type { PageProps } from './$types';
	import { get, post, del, errMsg } from '#lib/client/api.ts';
	import { installDict } from '#lib/client/backend.svelte.ts';
	import { base } from '#lib/client/base.ts';
	import { japaneseVoices, preferredVoiceName, setPreferredVoice, speak, ttsSupported } from '#lib/client/tts.ts';
	import ConfirmDialog from '#lib/components/ConfirmDialog.svelte';
	import ModelPicker from '#lib/components/ModelPicker.svelte';
	import { version } from '$app/env';
	import AppSettings from '#lib/components/AppSettings.svelte';
	import { DEFAULT_PRESET, PRESETS, presetOf, type ModelPreset } from '#lib/modelPresets.ts';
	import { ago } from '#lib/client/version.ts';

	const builtAt = import.meta.env.VITE_BUILT_AT as string | undefined;

	let { data }: PageProps = $props();

	// Copia editable: el formulario no debe seguir a `data` mientras se edita.
	let s = $state(untrack(() => ({ ...data.settings })));
	let saved = $state(false);
	let error = $state('');
	let voices: SpeechSynthesisVoice[] = $state([]);
	let voice = $state('');

	async function save() {
		error = '';
		try {
			// El objetivo, los parámetros FSRS y los precios/presupuesto (en /costos) tienen sus propios botones:
			// no pisarlos con la copia del formulario.
			const { goal: _g, fsrsParams: _p, fsrsCalibratedAt: _c, modelPrices: _mp, monthlyBudgetUsd: _b, budgetHardStop: _h, ...rest } = s;
			s = await post('/api/settings', rest);
			saved = true;
			setTimeout(() => (saved = false), 1500);
			await refreshAll();
		} catch (e) {
			error = errMsg(e);
		}
	}

	// ---------- Objetivo ----------
	let goalLabel = $state(untrack(() => data.goal?.label ?? ''));
	let goalKanji = $state(untrack(() => data.goal?.target ?? data.milestones.find((m) => m.kanji > data.known)?.kanji ?? 300));
	let goalDate = $state(untrack(() => data.goal?.date ?? ''));
	const suggestedPace = $derived.by(() => {
		if (!goalDate) return null;
		const days = Math.ceil((new Date(`${goalDate}T23:59:59`).getTime() - Date.now()) / 86_400_000);
		return days > 0 ? Math.ceil((Math.max(0, goalKanji - data.known) / days) * 10) / 10 : null;
	});
	async function saveGoal() {
		await post('/api/settings', { goal: { label: goalLabel, kanji: goalKanji, date: goalDate } });
		await refreshAll();
	}
	async function clearGoal() {
		await post('/api/settings', { goal: null });
		goalLabel = '';
		goalDate = '';
		await refreshAll();
	}

	// ---------- Calibración FSRS ----------
	type Cal = { params: number[]; workloadBefore: number; workloadAfter: number; reviews: number };
	let cal = $state<Cal | null>(null);
	let calBusy = $state(false);
	let calMsg = $state('');
	let calApplyOpen = $state(false);
	let calResetOpen = $state(false);
	async function computeCal() {
		calBusy = true;
		calMsg = '';
		try {
			cal = await post<Cal>('/api/fsrs', { action: 'compute' });
		} catch (e) {
			calMsg = errMsg(e);
		} finally {
			calBusy = false;
		}
	}
	async function applyCal(reset: boolean) {
		calBusy = true;
		try {
			const r = await post<{ updated: number; backup: string }>('/api/fsrs', reset ? { action: 'reset' } : { action: 'apply', params: cal?.params });
			calMsg = `${r.updated} tarjetas reprogramadas. Copia previa: ${r.backup}.`;
			cal = null;
			calApplyOpen = calResetOpen = false;
			await refreshAll();
		} catch (e) {
			calMsg = errMsg(e);
		} finally {
			calBusy = false;
		}
	}

	// ---------- API key y diccionario ----------
	const origin = typeof location !== 'undefined' ? `${location.origin}${base}/*` : '';
	let apiKey = $state('');
	let keyBusy = $state(false);
	let keyMsg = $state('');
	let keyError = $state(false);
	async function saveKey() {
		keyBusy = true;
		keyMsg = '';
		try {
			const r = await post<{ models: number }>('/api/gemini-key', { key: apiKey });
			apiKey = '';
			keyError = false;
			keyMsg = `Guardada ✓ (Gemini responde: ${r.models} modelos disponibles).`;
			await refreshAll();
		} catch (e) {
			keyError = true;
			keyMsg = errMsg(e);
		} finally {
			keyBusy = false;
		}
	}
	async function removeKey() {
		keyBusy = true;
		try {
			await del('/api/gemini-key');
			keyMsg = 'Quitada.';
			keyError = false;
			await refreshAll();
		} finally {
			keyBusy = false;
		}
	}

	// ---------- Modelos ----------
	// Perfil = par de modelos efectivos (vacío = el de por defecto). «Equilibrado» se guarda vacío: sigue lo recomendado.
	const effPro = $derived(s.modelPro || data.env.modelPro);
	const effFlash = $derived(s.modelFlash || data.env.modelFlash);
	const currentPreset = $derived(presetOf(effPro, effFlash));
	let presetMsg = $state('');
	async function applyPreset(p: ModelPreset) {
		const isDefault = p.id === DEFAULT_PRESET && data.env.modelPro === p.pro && data.env.modelFlash === p.flash;
		const patch = { modelPro: isDefault ? '' : p.pro, modelFlash: isDefault ? '' : p.flash };
		try {
			const r = await post<typeof s>('/api/settings', patch);
			s.modelPro = r.modelPro;
			s.modelFlash = r.modelFlash;
			presetMsg = `${p.icon} ${p.label} activado.`;
			setTimeout(() => (presetMsg = ''), 3000);
			await refreshAll();
		} catch (e) {
			presetMsg = errMsg(e);
		}
	}
	const costOfPreset = (id: string) => data.presetCosts.find((c) => c.id === id);
	const baseMix = $derived(costOfPreset(DEFAULT_PRESET)?.mix ?? null);
	const usd = (n: number) => (n < 0.01 ? '< $0,01' : `$${n.toFixed(2).replace('.', ',')}`);

	let pickerRole: 'pro' | 'flash' = $state('pro');
	let pickerOpen = $state(false);
	function openPicker(role: 'pro' | 'flash') {
		pickerRole = role;
		pickerOpen = true;
	}

	onMount(() => {
		if (!ttsSupported()) return;
		const refresh = () => {
			voices = japaneseVoices();
			voice = preferredVoiceName() ?? voices[0]?.name ?? '';
		};
		refresh();
		speechSynthesis.addEventListener('voiceschanged', refresh);
		return () => speechSynthesis.removeEventListener('voiceschanged', refresh);
	});
</script>

<svelte:head><title>Ajustes · Sensei</title></svelte:head>

<h1>Ajustes <HelpLink section="ajustes" /></h1>
<p class="small muted">¿Quieres volver a los valores por defecto? <a href="/datos">Datos → Restablecer ajustes</a>.</p>

<div class="card stack">
	<h2>Ritmo</h2>
	<div class="cols">
		<div>
			<label for="nk">Kanji nuevos por día</label>
			<input id="nk" type="number" min="0" max="50" bind:value={s.newKanjiPerDay} />
		</div>
		<div>
			<label for="nv">Palabras nuevas por día</label>
			<input id="nv" type="number" min="0" max="50" bind:value={s.newVocabPerDay} />
		</div>
		<div>
			<label for="ng">Puntos de gramática por día</label>
			<input id="ng" type="number" min="0" max="10" bind:value={s.newGrammarPerDay} />
		</div>
		<div>
			<label for="ds">El día empieza a las (hora)</label>
			<input id="ds" type="number" min="0" max="23" bind:value={s.dayStartHour} />
		</div>
	</div>
	<p class="dim small">
		Freno automático: con {data.brake.half}+ repasos pendientes las lecciones se reducen a la mitad; con {data.brake.stop}+ se
		pausan.
	</p>
</div>

<div class="card stack" id="objetivo">
	<h2>Objetivo con fecha</h2>
	<p class="small muted">
		«Quiero leer X para tal día»: Sensei calcula cuántos kanji al día necesitas y te avisa si te desvías. Conoces {data.known} kanji.
		También puedes crear un objetivo desde un texto de la <a href="/biblioteca">Biblioteca</a> (todos sus kanji a la cola).
	</p>
	{#if data.goal}
		<div class="small" class:warning={!data.goal.onTrack}>
			<strong>{data.goal.label}</strong> · {data.goal.known}/{data.goal.target} kanji · {data.goal.daysLeft} días — {data.goal.message}
		</div>
	{/if}
	<div class="cols">
		<div>
			<label for="gl">Qué quieres leer</label>
			<input id="gl" bind:value={goalLabel} placeholder="p. ej. Dragon Quest XI" />
		</div>
		<div>
			<label for="gk">Kanji necesarios</label>
			<select id="gk" bind:value={goalKanji}>
				{#each data.milestones as m (m.id)}<option value={m.kanji}>{m.kanji} — {m.title}</option>{/each}
			</select>
		</div>
		<div>
			<label for="gd">Fecha</label>
			<input id="gd" type="date" bind:value={goalDate} />
		</div>
	</div>
	<div class="row">
		<button onclick={saveGoal} disabled={!goalLabel || !goalDate}>Guardar objetivo</button>
		{#if data.goal}<button class="ghost" onclick={clearGoal}>Quitar objetivo</button>{/if}
		{#if suggestedPace}<span class="small muted">Ritmo necesario: ~{suggestedPace} kanji/día</span>{/if}
	</div>
</div>

<div class="card stack">
	<h2>SRS</h2>
	<div>
		<label for="ret">Retención objetivo: {Math.round(s.desiredRetention * 100)}%</label>
		<input id="ret" type="range" min="0.8" max="0.95" step="0.01" bind:value={s.desiredRetention} />
		<p class="dim small">
			Qué % de tarjetas quieres recordar al repasarlas. Más alto = intervalos más cortos y más repasos diarios; 90% es el
			equilibrio habitual. Se aplica a los próximos repasos (Guardar).
		</p>
	</div>
	<div class="stack">
		<h3>Calibrar con tu memoria</h3>
		<p class="small muted">
			FSRS usa 21 parámetros que describen cómo olvida una persona media. Con tu historial ({data.fsrs.reviews} repasos; mínimo
			{data.fsrs.minReviews}) puede ajustarlos a ti: suele bajar la carga diaria sin perder retención.
			{#if data.settings.fsrsCalibratedAt}Última calibración: {new Date(data.settings.fsrsCalibratedAt).toLocaleDateString('es')}.{/if}
		</p>
		<div class="row">
			<button onclick={computeCal} disabled={calBusy || data.fsrs.reviews < data.fsrs.minReviews}>
				{#if calBusy}<span class="spinner"></span>{/if} Calcular
			</button>
			{#if data.settings.fsrsParams}<button class="ghost" onclick={() => (calResetOpen = true)}>Volver a los parámetros por defecto</button>{/if}
		</div>
		{#if cal}
			<div class="card small">
				Repasos previstos en 30 días (si aciertas todo): <strong>{cal.workloadBefore}</strong> ahora →
				<strong>{cal.workloadAfter}</strong> con tus parámetros
				({cal.workloadAfter <= cal.workloadBefore ? '▼' : '▲'} {Math.abs(Math.round(((cal.workloadAfter - cal.workloadBefore) / Math.max(1, cal.workloadBefore)) * 100))}%).
				<div class="row" style="margin-top:0.5rem">
					<button class="primary small" onclick={() => (calApplyOpen = true)}>Aplicar y reprogramar</button>
					<button class="ghost small" onclick={() => (cal = null)}>Descartar</button>
				</div>
			</div>
		{/if}
		{#if calMsg}<div class="small">{calMsg}</div>{/if}
	</div>
</div>

<div class="card stack">
	<h2>Lectura</h2>
	<div>
		<label for="fu">Furigana</label>
		<select id="fu" bind:value={s.furigana}>
			<option value="adaptive">Adaptativa: se oculta en kanji cuya lectura dominas (pasa el ratón para verla)</option>
			<option value="always">Siempre visible</option>
			<option value="never">Oculta (pasa el ratón para verla)</option>
		</select>
	</div>
	<label class="check">
		<input type="checkbox" bind:checked={s.fontVariety} />
		<span>Fuentes variadas en los repasos (mincho, a mano, pincel, manga…): reconocer un kanji en una sola fuente no basta para leerlo en una viñeta</span>
	</label>
	<label class="check">
		<input type="checkbox" bind:checked={s.writingReviews} />
		<span>
			✍ Repasos de escritura: trazar de memoria los kanji que ya reconoces (opcional; añade repasos). Entran
			<input type="number" min="1" max="30" bind:value={s.newWritingPerDay} style="width:4rem" disabled={!s.writingReviews} /> nuevos al día. No
			cambia el estado de tus kanji.
		</span>
	</label>
	<label class="check"><input type="checkbox" bind:checked={s.ttsEnabled} /> Botones de audio (TTS del navegador)</label>
	{#if s.ttsEnabled}
		{#if voices.length}
			<div class="row">
				<select bind:value={voice} onchange={() => setPreferredVoice(voice)} style="width:auto">
					{#each voices as v (v.name)}<option value={v.name}>{v.name}</option>{/each}
				</select>
				<button class="small" onclick={() => speak('こんにちは、日本語を読みましょう。')}>Probar</button>
			</div>
		{:else}
			<p class="warning small">
				No hay voces japonesas instaladas en este dispositivo. En Windows: Configuración → Hora e idioma → Voz → Agregar voces →
				Japonés.
			</p>
		{/if}
	{/if}
</div>

<div class="card stack" id="gemini">
	<h2>API key de Gemini</h2>
	<p class="small muted">
		Créala gratis en <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer">Google AI Studio</a>. Se guarda solo en
		este navegador (no viaja en las exportaciones ni en las copias). Cualquiera con acceso a este navegador podría usarla:
		<strong>restríngela</strong> en Google Cloud a esta dirección (<code>{origin}</code>) y a la «Generative Language API», y ponle un
		presupuesto en <a href="/costos">Costos</a>.
	</p>
	{#if data.env.gemini}
		<p class="small">Configurada: <code>{data.env.apiKey}</code></p>
	{/if}
	<div class="row">
		<input class="grow" type="password" bind:value={apiKey} placeholder={data.env.gemini ? 'Pegar otra key…' : 'Pega tu API key (AIza…)'} autocomplete="off" />
		<button onclick={saveKey} disabled={keyBusy || !apiKey.trim()}>{#if keyBusy}<span class="spinner"></span>{/if} Probar y guardar</button>
		{#if data.env.gemini}<button class="ghost" onclick={removeKey} disabled={keyBusy}>Quitar</button>{/if}
	</div>
	{#if keyMsg}<p class="small" class:error={keyError}>{keyMsg}</p>{/if}
</div>

<div class="card stack">
	<h2>Modelos de Gemini</h2>
	<div class="presets">
		{#each PRESETS as p (p.id)}
			{@const c = costOfPreset(p.id)}
			<button class="preset" class:sel={currentPreset === p.id} onclick={() => applyPreset(p)} aria-pressed={currentPreset === p.id}>
				<strong>{p.icon} {p.label}{#if p.id === DEFAULT_PRESET} <span class="small muted">· recomendado</span>{/if}</strong>
				<span class="small">{p.desc}</span>
				<span class="small dim"><code>{p.pro}</code> + <code>{p.flash}</code></span>
				<span class="small cost">
					{#if c?.usd != null}Tu último mes: ≈ {usd(c.usd)}
					{:else if c?.mix != null && baseMix}{c.mix / baseMix < 0.95 ? `~${(baseMix / c.mix).toFixed(1).replace('.', ',')}× más barato` : c.mix / baseMix > 1.05 ? `~${(c.mix / baseMix).toFixed(1).replace('.', ',')}× más caro` : 'referencia'}{/if}
				</span>
			</button>
		{/each}
	</div>
	{#if currentPreset === 'custom'}<p class="small muted">Ahora: <strong>personalizado</strong> (modelos elegidos a mano abajo).</p>{/if}
	{#if presetMsg}<p class="small">{presetMsg}</p>{/if}
	<p class="dim small">
		Costos a precios de hoy y suponiendo los mismos tokens (un modelo que razona más gasta más). Argon sube al doble el 1 de diciembre y
		los Flash 3.6/3.8, el 1 de enero. Detalle en <a href="/costos">Costos</a>.
	</p>
	<details>
		<summary class="small">Elegir los modelos a mano</summary>
	<p class="dim small">Vacío = el de por defecto (Pro: <code>{data.env.modelPro}</code>, Flash: <code>{data.env.modelFlash}</code>).</p>
	<div class="cols">
		<div>
			<label for="mp">Pro (tutor, lecturas, explicador, mnemotecnias)</label>
			<div class="pick">
				<input id="mp" bind:value={s.modelPro} placeholder={data.env.modelPro} />
				<button class="small" onclick={() => openPicker('pro')} disabled={!data.env.gemini}>Elegir…</button>
			</div>
		</div>
		<div>
			<label for="mf">Flash (resúmenes, informe, traducciones)</label>
			<div class="pick">
				<input id="mf" bind:value={s.modelFlash} placeholder={data.env.modelFlash} />
				<button class="small" onclick={() => openPicker('flash')} disabled={!data.env.gemini}>Elegir…</button>
			</div>
		</div>
	</div>
	<p class="dim small">«Elegir…» muestra los modelos de tu API key con su precio y lo que te costarían con tu uso real. Recuerda guardar.</p>
	</details>
</div>

<ModelPicker
	bind:open={pickerOpen}
	role={pickerRole}
	value={pickerRole === 'flash' ? s.modelFlash : s.modelPro}
	onpick={(id) => {
		if (pickerRole === 'flash') s.modelFlash = id;
		else s.modelPro = id;
	}}
/>

<div class="row">
	<button class="primary" onclick={save}>Guardar</button>
	{#if saved}<span class="muted">Guardado ✓</span>{/if}
	{#if error}<span class="error small">{error}</span>{/if}
</div>

<ConfirmDialog bind:open={calApplyOpen} title="Aplicar calibración" confirmLabel="Aplicar" danger={false} busy={calBusy} onconfirm={() => applyCal(false)}>
	<p>Se guardan tus parámetros y se reprograman todas las tarjetas a partir de su historial. Antes se crea una copia de seguridad.</p>
</ConfirmDialog>
<ConfirmDialog bind:open={calResetOpen} title="Parámetros por defecto" confirmLabel="Restablecer" busy={calBusy} onconfirm={() => applyCal(true)}>
	<p>Se vuelven a usar los parámetros de FSRS por defecto y se reprograman las tarjetas. Antes se crea una copia.</p>
</ConfirmDialog>

<div class="card stack" id="diccionario">
	<h2>Diccionario</h2>
	<p class="small muted">
		Instalado: <strong>{data.dict.variant === 'full' ? 'JMdict completo' : 'palabras comunes'}</strong>
		{#if data.dict.version}<span class="dim">(versión <code>{data.dict.version}</code>)</span>{/if}. Cambiarlo descarga el otro y
		restaura tu progreso encima; antes se guarda una copia.
	</p>
	<div class="row">
		{#if data.dict.variant === 'full'}
			<button class="small" onclick={() => installDict('common')}>Cambiar a palabras comunes (más ligero)</button>
		{:else}
			<button class="small" onclick={() => installDict('full')}>Descargar JMdict completo (mejores búsquedas)</button>
		{/if}
	</div>
</div>

<AppSettings />

<p class="small dim">
	Versión de Sensei: <code>{version}</code>{#if builtAt && version !== 'dev'} · publicada {ago(builtAt)}
		({new Date(builtAt).toLocaleString('es', { dateStyle: 'medium', timeStyle: 'short' })}){/if}. Se actualiza sola al volver a la
	pestaña.
</p>

<style>
	.pick {
		display: flex;
		gap: 0.4rem;
	}
	.presets {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
		gap: 0.6rem;
	}
	.preset {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 0.25rem;
		padding: 0.8rem 0.9rem;
		text-align: left;
	}
	.preset.sel {
		border-color: var(--accent);
		box-shadow: inset 0 0 0 1px var(--accent);
	}
	.preset code {
		font-size: 0.75rem;
	}
	.preset .cost {
		margin-top: auto;
		color: var(--text);
	}
	.pick input {
		flex: 1;
		min-width: 0;
	}
	.cols {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
		gap: 0.8rem;
	}
	.check {
		display: flex;
		gap: 0.5rem;
		align-items: center;
		color: var(--text);
	}
	.check input {
		width: auto;
	}
	.grow {
		flex: 1;
		min-width: 12rem;
	}
</style>
