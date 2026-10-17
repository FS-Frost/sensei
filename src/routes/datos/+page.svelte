<script lang="ts">
	import { onMount } from 'svelte';
	import { refreshAll } from '$app/navigation';
	import { del, get, post, errMsg, ApiError } from '#lib/client/api.ts';
	import { THEME_KEY, initTheme } from '#lib/client/theme.svelte.ts';
	import ConfirmDialog from '#lib/components/ConfirmDialog.svelte';
	import HelpLink from '#lib/components/HelpLink.svelte';
	import { downloadFrom } from '#lib/client/backend.svelte.ts';

	type Counts = Record<string, number>;
	type Backup = { name: string; kind: string; label: string; createdAt: number; size: number };
	type Preview = { createdAt: string; kind: string; incoming: Counts; current: Counts };
	type ResetPreview = Record<string, number>;

	let current: Counts = $state({});
	let backups: Backup[] = $state([]);
	let retention = $state(7);
	let msg = $state('');
	let error = $state('');
	let busy = $state(false);

	const LABEL: Record<string, string> = {
		cards: 'tarjetas del SRS',
		reviews: 'respuestas en el historial',
		confusions: 'confusiones',
		sessions: 'sesiones del tutor',
		messages: 'mensajes del tutor',
		notes: 'notas del tutor',
		texts: 'lecturas y explicaciones guardadas',
		settings: 'ajustes',
		mnemonics: 'mnemotecnias',
		userVocab: 'palabras propias',
		translations: 'traducciones/nombres generados',
		minedSentences: 'frases guardadas',
		readings: 'lecturas cronometradas',
		reports: 'informes semanales',
		library: 'textos de la biblioteca',
		usage: 'llamadas a Gemini en el registro de costos'
	};

	async function load() {
		const r = await get<{ current: Counts; backups: Backup[]; retentionDays: number }>('/api/data');
		current = r.current;
		backups = r.backups;
		retention = r.retentionDays;
	}

	async function download(path: string, name: string) {
		try {
			await downloadFrom(path, name);
		} catch (e) {
			error = errMsg(e);
		}
	}

	function done(text: string) {
		msg = text;
		error = '';
		setTimeout(() => (msg = ''), 6000);
	}

	const fmtSize = (b: number) => (b < 1024 ? `${b} B` : b < 1048576 ? `${(b / 1024).toFixed(1)} KB` : `${(b / 1048576).toFixed(1)} MB`);
	const fmtDate = (t: number | string) => new Date(t).toLocaleString('es', { dateStyle: 'medium', timeStyle: 'short' });
	const nonZero = (c: Counts) => Object.entries(c).filter(([, n]) => n > 0);

	// ---------- Importar ----------
	let fileInput: HTMLInputElement | undefined = $state();
	let pendingFile: File | null = $state(null);
	let importPreview: Preview | null = $state(null);
	let importOpen = $state(false);

	async function upload(file: File, dry: boolean) {
		const fd = new FormData();
		fd.append('file', file);
		const res = await fetch(`/api/data/import${dry ? '?dry=1' : ''}`, { method: 'POST', body: fd });
		const data = await res.json().catch(() => ({}));
		if (!res.ok) throw new ApiError(res.status, data.error ?? `Error ${res.status}`);
		return data as Preview & { backup?: string };
	}

	async function pickFile(e: Event) {
		const f = (e.target as HTMLInputElement).files?.[0];
		(e.target as HTMLInputElement).value = '';
		if (!f) return;
		error = '';
		try {
			importPreview = await upload(f, true);
			pendingFile = f;
			importOpen = true;
		} catch (err) {
			error = errMsg(err);
		}
	}

	async function confirmImport() {
		if (!pendingFile) return;
		busy = true;
		try {
			const r = await upload(pendingFile, false);
			importOpen = false;
			done(`Importado. Tu estado anterior quedó guardado en la copia «${r.backup}».`);
			await Promise.all([load(), refreshAll()]);
		} catch (err) {
			error = errMsg(err);
		} finally {
			busy = false;
		}
	}

	// ---------- Copias ----------
	let restoreTarget: Backup | null = $state(null);
	let restorePreview: Preview | null = $state(null);
	let restoreOpen = $state(false);
	let deleteTarget: Backup | null = $state(null);
	let deleteOpen = $state(false);

	async function backupNow() {
		busy = true;
		try {
			const b = await post<Backup>('/api/data/backups');
			done(`Copia creada: ${b.name}`);
			await load();
		} catch (err) {
			error = errMsg(err);
		} finally {
			busy = false;
		}
	}

	async function askRestore(b: Backup) {
		error = '';
		try {
			restorePreview = await post<Preview>(`/api/data/backups/${encodeURIComponent(b.name)}/restore?dry=1`);
			restoreTarget = b;
			restoreOpen = true;
		} catch (err) {
			error = errMsg(err);
		}
	}

	async function confirmRestore() {
		if (!restoreTarget) return;
		busy = true;
		try {
			const r = await post<{ backup: string }>(`/api/data/backups/${encodeURIComponent(restoreTarget.name)}/restore`);
			restoreOpen = false;
			done(`Restaurado. El estado previo quedó en «${r.backup}».`);
			await Promise.all([load(), refreshAll()]);
		} catch (err) {
			error = errMsg(err);
		} finally {
			busy = false;
		}
	}

	async function confirmDelete() {
		if (!deleteTarget) return;
		busy = true;
		try {
			await del(`/api/data/backups/${encodeURIComponent(deleteTarget.name)}`);
			deleteOpen = false;
			done('Copia borrada.');
			await load();
		} catch (err) {
			error = errMsg(err);
		} finally {
			busy = false;
		}
	}

	// ---------- Reinicio de progreso ----------
	let rKana = $state(false);
	let rKanji = $state(false);
	let rVocab = $state(false);
	let rAll = $state(false);
	let rTutor = $state(false);
	let rGenerated = $state(false);
	let rGrammar = $state(false);
	let rSentence = $state(false);
	let rLibrary = $state(false);
	let rUsage = $state(false);
	let resetPreview: ResetPreview | null = $state(null);
	let resetOpen = $state(false);

	const resetReq = $derived({
		progress: rAll
			? ('all' as const)
			: [
					...(rKana ? ['kana'] : []),
					...(rKanji ? ['kanji'] : []),
					...(rVocab ? ['vocab'] : []),
					...(rGrammar ? ['grammar'] : []),
					...(rSentence ? ['sentence'] : [])
				],
		tutor: rTutor,
		generated: rGenerated,
		library: rLibrary,
		usage: rUsage
	});
	const nothingSelected = $derived(
		!rAll && !rKana && !rKanji && !rVocab && !rGrammar && !rSentence && !rTutor && !rGenerated && !rLibrary && !rUsage
	);

	function preset(kind: 'zero' | 'progress') {
		rAll = true;
		rKana = rKanji = rVocab = rGrammar = rSentence = false;
		rTutor = rGenerated = rLibrary = rUsage = kind === 'zero';
	}

	async function askReset() {
		error = '';
		try {
			resetPreview = (await post<{ preview: ResetPreview }>('/api/data/reset', { ...resetReq, dry: true })).preview;
			resetOpen = true;
		} catch (err) {
			error = errMsg(err);
		}
	}

	async function confirmReset() {
		busy = true;
		try {
			const r = await post<{ backup: string }>('/api/data/reset', resetReq);
			resetOpen = false;
			rKana = rKanji = rVocab = rGrammar = rSentence = rAll = rTutor = rGenerated = rLibrary = rUsage = false;
			done(`Reiniciado. Si te arrepientes, restaura la copia «${r.backup}».`);
			await Promise.all([load(), refreshAll()]);
		} catch (err) {
			error = errMsg(err);
		} finally {
			busy = false;
		}
	}

	// ---------- Reinicio de ajustes ----------
	let settingsOpen = $state(false);
	async function confirmSettingsReset() {
		busy = true;
		try {
			await post('/api/settings/reset');
			// Preferencias de este dispositivo
			localStorage.removeItem(THEME_KEY);
			localStorage.removeItem('sensei.ttsVoice');
			initTheme();
			settingsOpen = false;
			done('Ajustes restablecidos (también los de este dispositivo). La bienvenida volverá a ofrecerse.');
			await Promise.all([load(), refreshAll()]);
		} catch (err) {
			error = errMsg(err);
		} finally {
			busy = false;
		}
	}

	onMount(() => {
		load().catch((e) => (error = errMsg(e)));
	});
</script>

<svelte:head><title>Datos · Sensei</title></svelte:head>

<h1>Datos y copias <HelpLink section="datos" /></h1>

{#if msg}<div class="card ok small">{msg}</div>{/if}
{#if error}<div class="error small">{error}</div>{/if}

<div class="card stack">
	<h2>Qué se guarda</h2>
	<p class="small muted">
		Tu progreso del SRS e historial de respuestas, confusiones, sesiones y notas del tutor, lecturas guardadas, ajustes, todo lo que
		generó Gemini (mnemotecnias, traducciones) y el registro de costos. <strong>No</strong> se guardan los diccionarios (se descargan
		del sitio), ni la API key de Gemini, ni el tema y la voz de cada dispositivo.
	</p>
	<p class="small muted">
		<strong>Todo vive en este navegador.</strong> Otro navegador u otro dispositivo (el móvil) tiene sus propios datos: para pasar tu
		progreso, usa <a href="/sincronizar">Sincronizar</a> (por sonido y red local, sin internet) o exporta aquí e importa allí. Si borras
		los datos del sitio en el navegador, se pierden: descarga un .zip de vez en cuando.
	</p>
	<div><a class="btn small" href="/sincronizar">同 Sincronizar con otro dispositivo</a></div>
	{#if nonZero(current).length}
		<div class="row small">
			{#each nonZero(current) as [k, n] (k)}<span class="badge">{n} {LABEL[k] ?? k}</span>{/each}
		</div>
	{:else}
		<p class="small dim">Aún no hay datos tuyos.</p>
	{/if}
</div>

<div class="two">
	<div class="card stack">
		<h2>Exportar</h2>
		<p class="small muted">Descarga un .zip con todos tus datos. Sirve para pasar a otro navegador o dispositivo, o guardar una copia fuera.</p>
		<div><button class="primary" onclick={() => download('/api/data/export', 'sensei.zip')} disabled={busy}>⬇ Descargar .zip</button></div>
	</div>
	<div class="card stack">
		<h2>Importar</h2>
		<p class="small muted">
			Carga un .zip exportado o una copia. <strong>Reemplaza</strong> tu estado actual; antes se guarda una copia automática por si
			acaso. Las mnemotecnias y traducciones se suman a las existentes.
		</p>
		<input type="file" accept=".zip,application/zip" bind:this={fileInput} onchange={pickFile} hidden />
		<button onclick={() => fileInput?.click()}>⬆ Elegir .zip…</button>
	</div>
</div>

<div class="card stack">
	<div class="spread">
		<h2>Copias de seguridad</h2>
		<button onclick={backupNow} disabled={busy}>Crear copia ahora</button>
	</div>
	<p class="small muted">
		Se crea una automática al día (si hubo cambios) y otra antes de cada importación, restauración o reinicio. Se borran solas las de
		más de {retention} días, pero la más reciente se conserva siempre. Se guardan en el almacenamiento privado de este navegador:
		descárgalas si quieres tenerlas fuera.
	</p>
	{#if backups.length}
		<table class="small">
			<thead><tr><th>Fecha</th><th>Tipo</th><th>Tamaño</th><th></th></tr></thead>
			<tbody>
				{#each backups as b (b.name)}
					<tr>
						<td>{fmtDate(b.createdAt)}</td>
						<td>{b.label}</td>
						<td class="num">{fmtSize(b.size)}</td>
						<td class="acts">
							<button class="small" onclick={() => download(`/api/data/backups/${encodeURIComponent(b.name)}`, b.name)}>Descargar</button>
							<button class="small" onclick={() => askRestore(b)}>Restaurar</button>
							<button
								class="small ghost"
								onclick={() => {
									deleteTarget = b;
									deleteOpen = true;
								}}>Borrar</button
							>
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	{:else}
		<p class="small dim">Todavía no hay copias. La primera automática se hará cuando tengas datos.</p>
	{/if}
</div>

<div class="card stack">
	<h2>Reiniciar progreso</h2>
	<p class="small muted">
		Borra tarjetas y su historial (precisión, puntos débiles y confusiones dejan de contarlos). Siempre se crea una copia antes. Para
		reiniciar un solo kanji o palabra, usa el botón de su ficha.
	</p>
	<div class="row">
		<button class="small" onclick={() => preset('zero')}>Empezar de cero</button>
		<button class="small" onclick={() => preset('progress')}>Solo el progreso</button>
	</div>
	<div class="opts">
		<label class="check">
			<input type="checkbox" bind:checked={rAll} />
			<span><strong>Todo el progreso</strong> — kana, componentes, kanji, vocabulario, gramática, frases, lecturas cronometradas y cola de estudio</span>
		</label>
		<label class="check" class:off={rAll}><input type="checkbox" bind:checked={rKana} disabled={rAll} /> <span>Kana — permite repetir el diagnóstico</span></label>
		<label class="check" class:off={rAll}>
			<input type="checkbox" bind:checked={rKanji} disabled={rAll} />
			<span>Kanji — incluye componentes y <strong>todo el vocabulario</strong>, que se desbloquea a partir de los kanji</span>
		</label>
		<label class="check" class:off={rAll}><input type="checkbox" bind:checked={rVocab} disabled={rAll} /> <span>Solo vocabulario (y sus frases guardadas) — los kanji se conservan</span></label>
		<label class="check" class:off={rAll}><input type="checkbox" bind:checked={rGrammar} disabled={rAll} /> <span>Gramática</span></label>
		<label class="check" class:off={rAll}><input type="checkbox" bind:checked={rSentence} disabled={rAll} /> <span>Solo frases guardadas</span></label>
		<label class="check"><input type="checkbox" bind:checked={rLibrary} /> <span>Biblioteca — textos y sus lecturas</span></label>
		<label class="check"><input type="checkbox" bind:checked={rTutor} /> <span>Memoria del tutor — sesiones, resúmenes, notas e informes semanales</span></label>
		<label class="check">
			<input type="checkbox" bind:checked={rGenerated} />
			<span>Contenido generado — lecturas guardadas, mnemotecnias y traducciones de Gemini (se regeneran al usarse; consume cuota)</span>
		</label>
		<label class="check">
			<input type="checkbox" bind:checked={rUsage} />
			<span>Registro de costos — el historial de llamadas a Gemini y su gasto (<a href="/costos">Costos</a> vuelve a cero)</span>
		</label>
	</div>
	<div><button class="primary" onclick={askReset} disabled={nothingSelected}>Revisar y reiniciar…</button></div>
</div>

<div class="card stack">
	<h2>Restablecer ajustes</h2>
	<p class="small muted">
		Vuelve a los valores por defecto: ritmo (10 kanji y 10 palabras al día), furigana adaptativa, audio activado, modelos por defecto,
		inicio del día a las 4:00. También borra el tema y la voz de <strong>este</strong> dispositivo. No toca tu progreso ni la API key.
	</p>
	<div><button onclick={() => (settingsOpen = true)}>Restablecer ajustes…</button></div>
</div>

<!-- Diálogos -->
<ConfirmDialog bind:open={importOpen} title="Importar y reemplazar" word="REEMPLAZAR" confirmLabel="Importar" {busy} onconfirm={confirmImport}>
	{#if importPreview}
		<p>Archivo del {fmtDate(importPreview.createdAt)}. Contiene:</p>
		<ul>
			{#each nonZero(importPreview.incoming) as [k, n] (k)}<li>{n} {LABEL[k] ?? k}</li>{/each}
		</ul>
		{#if nonZero(importPreview.current).length}
			<p>Se reemplazará tu estado actual ({nonZero(importPreview.current).map(([k, n]) => `${n} ${LABEL[k] ?? k}`).join(', ')}). Antes se guardará una copia.</p>
		{/if}
	{/if}
</ConfirmDialog>

<ConfirmDialog bind:open={restoreOpen} title="Restaurar copia" word="REEMPLAZAR" confirmLabel="Restaurar" {busy} onconfirm={confirmRestore}>
	{#if restorePreview && restoreTarget}
		<p>Volverás al estado del {fmtDate(restoreTarget.createdAt)} ({restoreTarget.label.toLowerCase()}):</p>
		<ul>
			{#each nonZero(restorePreview.incoming) as [k, n] (k)}<li>{n} {LABEL[k] ?? k}</li>{/each}
		</ul>
		<p>Lo que hayas hecho después se perderá, salvo en la copia «antes de restaurar» que se crea ahora.</p>
	{/if}
</ConfirmDialog>

<ConfirmDialog bind:open={deleteOpen} title="Borrar copia" confirmLabel="Borrar" {busy} onconfirm={confirmDelete}>
	{#if deleteTarget}<p>¿Borrar la copia del {fmtDate(deleteTarget.createdAt)}? No se puede deshacer.</p>{/if}
</ConfirmDialog>

<ConfirmDialog bind:open={resetOpen} title="Reiniciar" word="REINICIAR" confirmLabel="Reiniciar" {busy} onconfirm={confirmReset}>
	{#if resetPreview}
		{#if nonZero(resetPreview).length}
			<p>Se borrará:</p>
			<ul>
				{#each nonZero(resetPreview) as [k, n] (k)}<li>{n} {LABEL[k] ?? k}</li>{/each}
			</ul>
			<p>Antes se crea una copia «antes de reiniciar»: podrás restaurarla desde esta página.</p>
		{:else}
			<p>No hay nada que borrar con esa selección.</p>
		{/if}
	{/if}
</ConfirmDialog>

<ConfirmDialog bind:open={settingsOpen} title="Restablecer ajustes" word="REINICIAR" confirmLabel="Restablecer" {busy} onconfirm={confirmSettingsReset}>
	<p>Los ajustes y las preferencias de este dispositivo volverán a sus valores por defecto. Tu progreso no cambia.</p>
</ConfirmDialog>

<style>
	.two {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
		gap: 1rem;
	}
	.ok {
		border-color: var(--ok);
	}
	table {
		border-collapse: collapse;
		width: 100%;
	}
	th,
	td {
		text-align: left;
		padding: 0.4rem;
		border-bottom: 1px solid var(--line);
	}
	th {
		color: var(--text-2);
		font-weight: 500;
	}
	.num {
		font-variant-numeric: tabular-nums;
	}
	.acts {
		display: flex;
		gap: 0.3rem;
		justify-content: flex-end;
		flex-wrap: wrap;
	}
	.opts {
		display: grid;
		gap: 0.45rem;
	}
	.check {
		display: flex;
		gap: 0.55rem;
		align-items: flex-start;
		color: var(--text);
		margin: 0;
	}
	.check input {
		width: auto;
		margin-top: 0.3rem;
	}
	.check.off {
		opacity: 0.5;
	}
	@media (max-width: 600px) {
		th:nth-child(3),
		td:nth-child(3) {
			display: none;
		}
	}
</style>
