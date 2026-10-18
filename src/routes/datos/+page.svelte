<script lang="ts">
	import { onMount } from 'svelte';
	import { refreshAll } from '$app/navigation';
	import { del, get, post, errMsg, ApiError } from '#lib/client/api.ts';
	import { toast } from '#lib/client/toast.svelte.ts';
	import { THEME_KEY, initTheme } from '#lib/client/theme.svelte.ts';
	import ConfirmDialog from '#lib/components/ConfirmDialog.svelte';
	import HelpLink from '#lib/components/HelpLink.svelte';
	import { downloadFrom } from '#lib/client/backend.svelte.ts';
	import { applyDevicePrefs, DEVICE_PREFS, readDevicePrefs } from '#lib/client/devicePrefs.ts';
	import { aiKey, aiUi } from '#lib/client/ai.svelte.ts';
	import { takePending } from '#lib/client/inbox.ts';
	import StoragePanel from '#lib/components/StoragePanel.svelte';
	import PregenPanel from '#lib/components/PregenPanel.svelte';
	import { page } from '$app/state';

	// Si se puede llamar a Gemini ahora (key + modo IA) lo da el layout; exportar la key solo pide que exista.
	const gemini = $derived(!!(page.data as { gemini?: boolean }).gemini);

	// Llegó un .zip compartido o abierto con Sensei (/compartir): mostrar qué contiene y pedir confirmación.
	onMount(() => {
		const f = takePending('datos')?.files[0];
		if (f) void previewImport(f);
	});

	type Counts = Record<string, number>;
	type Backup = { name: string; kind: string; label: string; createdAt: number; size: number };
	type Section = 'progress' | 'tutor' | 'library' | 'usage' | 'settings' | 'content';
	type Preview = {
		createdAt: string;
		kind: string;
		incoming: Counts;
		current: Counts;
		sections: { id: Section; incoming: Counts; current: Counts }[];
		device: Record<string, string> | null;
		hasKey: boolean;
		currentKey: boolean;
		dict: { variant: string; version: string | null } | null;
	};

	/** Secciones de exportar/importar (mismo orden e ids que SECTIONS en server/data/snapshot.ts). */
	const SECTION_INFO: Record<Section, { label: string; hint: string }> = {
		progress: { label: 'Progreso', hint: 'tarjetas del SRS, historial, confusiones, frases guardadas, cola de estudio y palabras propias' },
		tutor: { label: 'Memoria del tutor', hint: 'sesiones, resúmenes, notas e informes semanales' },
		library: { label: 'Biblioteca y lecturas', hint: 'textos importados, lecturas graduadas y explicaciones guardadas' },
		usage: { label: 'Registro de costos', hint: 'historial de llamadas a Gemini y su gasto' },
		settings: { label: 'Ajustes', hint: 'ritmo, modelos, presupuesto, objetivo…' },
		content: { label: 'Contenido generado', hint: 'mnemotecnias, traducciones y explicaciones creadas por Gemini (se suman, no reemplazan)' }
	};
	const SECTION_IDS = Object.keys(SECTION_INFO) as Section[];
	type ResetPreview = Record<string, number>;

	let current: Counts = $state({});
	let backups: Backup[] = $state([]);
	let retention = $state(7);
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
		usage: 'llamadas a Gemini en el registro de costos',
		queue: 'ítems en la cola de estudio'
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
			fail(e);
		}
	}

	function done(text: string) {
		toast.success(text, { duration: 6000 });
	}
	function fail(e: unknown) {
		toast.error(errMsg(e));
	}

	const fmtSize = (b: number) => (b < 1024 ? `${b} B` : b < 1048576 ? `${(b / 1024).toFixed(1)} KB` : `${(b / 1048576).toFixed(1)} MB`);
	const fmtDate = (t: number | string) => new Date(t).toLocaleString('es', { dateStyle: 'medium', timeStyle: 'short' });
	const nonZero = (c: Counts) => Object.entries(c).filter(([, n]) => n > 0);

	// ---------- Exportar ----------
	let exSections: Record<Section, boolean> = $state(Object.fromEntries(SECTION_IDS.map((x) => [x, true])) as Record<Section, boolean>);
	let exDevice = $state(true);
	let exKey = $state(false);
	let exPass = $state('');
	let exPass2 = $state('');
	const exChosen = $derived(SECTION_IDS.filter((x) => exSections[x]));
	const exPassError = $derived(
		!exKey ? '' : exPass.length < 8 ? 'Mínimo 8 caracteres' : exPass !== exPass2 ? 'Las contraseñas no coinciden' : ''
	);
	const exNothing = $derived(!exChosen.length && !exDevice && !exKey);

	async function exportZip() {
		busy = true;
		try {
			await downloadFrom('/api/data/export', 'sensei.zip', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					sections: exChosen,
					device: exDevice ? readDevicePrefs() : undefined,
					keyPassword: exKey ? exPass : undefined
				})
			});
			if (exKey) {
				exPass = exPass2 = '';
				toast.success('Exportado con la API key cifrada', { detail: 'Guarda la contraseña: sin ella no se puede recuperar.' });
			}
		} catch (e) {
			fail(e);
		} finally {
			busy = false;
		}
	}

	// ---------- Importar ----------
	let fileInput: HTMLInputElement | undefined = $state();
	let pendingFile: File | null = $state(null);
	let importPreview = $state<Preview | null>(null);
	let importOpen = $state(false);
	let imSections: Partial<Record<Section, boolean>> = $state({});
	let imDevice = $state(true);
	let imKey = $state(false);
	let imPass = $state('');
	const imChosen = $derived(SECTION_IDS.filter((x) => imSections[x]));
	const imNothing = $derived(!imChosen.length && !(imDevice && importPreview?.device) && !imKey);
	/** Al menos una sección elegida reemplaza algo que ya tienes: entonces se pide escribir REEMPLAZAR. */
	const imReplaces = $derived(
		!!importPreview &&
			importPreview.sections.some((x) => imSections[x.id] && x.id !== 'content' && Object.values(x.current).some((n) => n > 0))
	);
	const sum = (c: Counts) => Object.values(c).reduce((a, b) => a + b, 0);
	const describe = (c: Counts) =>
		Object.entries(c)
			.filter(([, n]) => n > 0)
			.map(([k, n]) => `${n} ${LABEL[k] ?? k}`)
			.join(', ') || 'nada';

	async function upload(file: File, dry: boolean, extra: { sections?: Section[]; keyPassword?: string } = {}) {
		const fd = new FormData();
		fd.append('file', file);
		if (extra.sections) fd.append('sections', JSON.stringify(extra.sections));
		if (extra.keyPassword !== undefined) fd.append('keyPassword', extra.keyPassword);
		const res = await fetch(`/api/data/import${dry ? '?dry=1' : ''}`, { method: 'POST', body: fd });
		const data = await res.json().catch(() => ({}));
		if (!res.ok) throw new ApiError(res.status, data.error ?? `Error ${res.status}`);
		return data as Preview & { backup?: string; applied?: Section[]; keyApplied?: boolean };
	}

	async function pickFile(e: Event) {
		const f = (e.target as HTMLInputElement).files?.[0];
		(e.target as HTMLInputElement).value = '';
		if (f) await previewImport(f);
	}

	/** Vista previa (sin cambiar nada) y diálogo de confirmación: también para un .zip compartido o abierto con Sensei. */
	async function previewImport(f: File) {
		try {
			const p = await upload(f, true);
			importPreview = p;
			pendingFile = f;
			// Por defecto todo lo que trae; las vacías desmarcadas (no hay nada que importar ahí).
			imSections = Object.fromEntries(p.sections.map((x) => [x.id, sum(x.incoming) > 0]));
			imDevice = !!p.device && Object.keys(p.device).length > 0;
			imKey = false;
			imPass = '';
			importOpen = true;
		} catch (err) {
			fail(err);
		}
	}

	async function confirmImport() {
		if (!pendingFile || !importPreview) return;
		busy = true;
		try {
			const sections = imChosen;
			const keyPassword = imKey ? imPass : undefined;
			const device = imDevice ? importPreview.device : null;
			let r: Awaited<ReturnType<typeof upload>> | null = null;
			if (sections.length || keyPassword !== undefined) r = await upload(pendingFile, false, { sections, keyPassword });
			const prefs = device ? applyDevicePrefs(device) : [];
			importOpen = false;
			const parts = [
				sections.length ? sections.map((x) => SECTION_INFO[x].label.toLowerCase()).join(', ') : '',
				r?.keyApplied ? 'API key de Gemini' : '',
				prefs.length ? `preferencias (${prefs.join(', ')})` : ''
			].filter(Boolean);
			toast.success(`Importado: ${parts.join(' · ') || 'sin cambios'}`, {
				detail: r?.backup ? `Tu estado anterior quedó en la copia «${r.backup}».` : undefined,
				duration: 8000
			});
			await Promise.all([load(), refreshAll()]);
		} catch (err) {
			// Contraseña incorrecta: el diálogo sigue abierto para corregirla.
			toast.error('No se pudo importar', { detail: errMsg(err), key: 'import' });
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
			fail(err);
		} finally {
			busy = false;
		}
	}

	async function askRestore(b: Backup) {
		try {
			restorePreview = await post<Preview>(`/api/data/backups/${encodeURIComponent(b.name)}/restore?dry=1`);
			restoreTarget = b;
			restoreOpen = true;
		} catch (err) {
			fail(err);
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
			fail(err);
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
			fail(err);
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
		try {
			resetPreview = (await post<{ preview: ResetPreview }>('/api/data/reset', { ...resetReq, dry: true })).preview;
			resetOpen = true;
		} catch (err) {
			fail(err);
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
			fail(err);
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
			fail(err);
		} finally {
			busy = false;
		}
	}

	onMount(() => {
		load().catch((e) => fail(e));
	});
</script>

<svelte:head><title>Datos · Sensei</title></svelte:head>

<h1>Datos y copias <HelpLink section="datos" /></h1>


<div class="card stack">
	<h2>Qué se guarda</h2>
	<p class="small muted">
		Tu progreso del SRS e historial de respuestas, confusiones, sesiones y notas del tutor, lecturas guardadas, ajustes, todo lo que
		generó Gemini (mnemotecnias, traducciones) y el registro de costos. <strong>No</strong> se guardan los diccionarios (se descargan
		del sitio). Al exportar puedes elegir qué secciones llevar, añadir las preferencias de este dispositivo (tema, voz, lector…) y,
		cifrada con una contraseña, la API key de Gemini. Las copias automáticas y la sincronización nunca llevan la key.
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
		<p class="small muted">Descarga un .zip para pasar a otro navegador o dispositivo, o guardar una copia fuera. Elige qué lleva:</p>
		<div class="opts">
			{#each SECTION_IDS as id (id)}
				<label class="check">
					<input type="checkbox" bind:checked={exSections[id]} />
					<span><strong>{SECTION_INFO[id].label}</strong> <span class="dim">— {SECTION_INFO[id].hint}</span></span>
				</label>
			{/each}
			<label class="check">
				<input type="checkbox" bind:checked={exDevice} />
				<span><strong>Preferencias de este dispositivo</strong> <span class="dim">— {Object.values(DEVICE_PREFS).join(', ')}</span></span>
			</label>
			<label class="check" class:off={!aiKey()}>
				<input type="checkbox" bind:checked={exKey} disabled={!aiKey()} />
				<span>
					<strong>API key de Gemini, cifrada</strong>
					<span class="dim">— {aiKey() ? 'con una contraseña que eliges ahora' : 'no hay una guardada aquí'}</span>
				</span>
			</label>
			{#if exKey}
				<div class="keybox stack">
					<p class="small warn-text">
						Quien tenga el .zip <strong>y</strong> la contraseña puede gastar en tu cuenta de Gemini. Sin la contraseña no hay forma de
						recuperarla: no se guarda en ningún sitio.
					</p>
					<input type="password" placeholder="Contraseña (mín. 8 caracteres)" bind:value={exPass} autocomplete="new-password" />
					<input type="password" placeholder="Repite la contraseña" bind:value={exPass2} autocomplete="new-password" />
					{#if exPassError && (exPass || exPass2)}<span class="small warn-text">{exPassError}</span>{/if}
				</div>
			{/if}
		</div>
		{#if exChosen.length < SECTION_IDS.length && exChosen.length}
			<p class="small dim">Exportación parcial: al importarla solo se reemplaza lo que lleva.</p>
		{/if}
		<div>
			<button class="primary" onclick={exportZip} disabled={busy || exNothing || !!exPassError}>⬇ Descargar .zip</button>
		</div>
	</div>
	<div class="card stack">
		<h2>Importar</h2>
		<p class="small muted">
			Carga un .zip exportado o una copia. Al elegirlo verás qué trae y podrás escoger qué secciones cargar: cada una
			<strong>reemplaza</strong> la tuya y las demás quedan intactas. Antes se guarda una copia automática. Las mnemotecnias y
			traducciones se suman a las existentes.
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

<StoragePanel onchange={() => void load()} />

{#if aiUi()}<PregenPanel gemini={gemini} />{/if}

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
<ConfirmDialog
	bind:open={importOpen}
	title="Importar"
	word={imReplaces ? 'REEMPLAZAR' : undefined}
	confirmLabel="Importar lo elegido"
	{busy}
	disabled={imNothing || (imKey && imPass.length === 0)}
	onconfirm={confirmImport}
>
	{#if importPreview}
		{@const p = importPreview}
		<p class="small">
			Archivo del {fmtDate(p.createdAt)}{p.sections.length < SECTION_IDS.length ? ' (exportación parcial)' : ''}{p.dict
				? ` · diccionario ${p.dict.variant === 'full' ? 'completo' : 'común'}`
				: ''}. Elige qué cargar:
		</p>
		<div class="opts">
			{#each p.sections as x (x.id)}
				{@const empty = sum(x.incoming) === 0}
				<label class="check" class:off={empty}>
					<input type="checkbox" bind:checked={imSections[x.id]} disabled={empty} />
					<span>
						<strong>{SECTION_INFO[x.id].label}</strong>
						<span class="small block">Trae: {describe(x.incoming)}</span>
						{#if imSections[x.id]}
							<span class="small block dim">
								{#if x.id === 'content'}Se suma a lo tuyo ({describe(x.current)}).
								{:else if sum(x.current) > 0}Reemplaza lo tuyo: {describe(x.current)}.
								{:else}Ahora no tienes nada aquí.{/if}
							</span>
						{/if}
					</span>
				</label>
			{/each}
			{#if p.device && Object.keys(p.device).length}
				<label class="check">
					<input type="checkbox" bind:checked={imDevice} />
					<span>
						<strong>Preferencias del dispositivo</strong>
						<span class="small block">{Object.keys(p.device).map((k) => DEVICE_PREFS[k] ?? k).join(', ')}</span>
						<span class="small block dim">Desmárcalo si pasas a un dispositivo distinto (p. ej. del PC al móvil).</span>
					</span>
				</label>
			{/if}
			{#if p.hasKey}
				<label class="check">
					<input type="checkbox" bind:checked={imKey} />
					<span>
						<strong>API key de Gemini (cifrada)</strong>
						<span class="small block dim">{p.currentKey ? 'Sustituirá la que tienes guardada aquí.' : 'Aquí aún no hay ninguna.'}</span>
					</span>
				</label>
				{#if imKey}
					<input type="password" placeholder="Contraseña con la que se exportó" bind:value={imPass} autocomplete="current-password" />
				{/if}
			{/if}
		</div>
		{#if imChosen.length}<p class="small">Antes se guardará una copia de tu estado actual.</p>{/if}
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
	.block {
		display: block;
	}
	.keybox {
		margin-left: 1.6rem;
		gap: 0.4rem;
	}
	.warn-text {
		color: var(--warn);
		margin: 0;
	}
	@media (max-width: 600px) {
		th:nth-child(3),
		td:nth-child(3) {
			display: none;
		}
	}
</style>
