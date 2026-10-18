<script lang="ts">
	// Laboratorio: ¿se oye el ultrasonido? ¿se emparejan dos dispositivos por sonido? (experimento, ver docs/sync-qr.md)
	import { onDestroy } from 'svelte';
	import type { GGWave, Instance } from 'ggwave';
	import {
		CAL_LEVELS,
		calMessage,
		DEFAULT_PROFILE,
		describeProfile,
		encodeToBuffer,
		loadProfile,
		makeInstance,
		parseCal,
		PROTOCOLS,
		randomPayload,
		recommendVolume,
		resetProfile,
		saveProfile,
		type ProtocolKey,
		type SoundProfile
	} from '#lib/client/sound.ts';
	import { listen, type Listener } from '#lib/client/sync/audio.ts';

	let ctx: AudioContext | null = null;
	function audio() {
		ctx ??= new AudioContext();
		if (ctx.state === 'suspended') void ctx.resume();
		return ctx;
	}

	let error = $state('');
	const err = (e: unknown) => (error = e instanceof Error ? e.message : String(e));

	// ---------- 1. ¿Molesta? ----------
	let volume = $state(10); // tono continuo: a 15-17 kHz molesta enseguida, empezar bajo
	let tone: { osc: OscillatorNode; gain: GainNode; timer?: ReturnType<typeof setInterval> } | null = null;
	let toneLabel = $state('');

	function stopTone() {
		if (!tone) return;
		clearInterval(tone.timer);
		tone.gain.gain.setTargetAtTime(0, tone.osc.context.currentTime, 0.02);
		const t = tone;
		setTimeout(() => t.osc.stop(), 120);
		tone = null;
		toneLabel = '';
	}

	function playTone(freq: number) {
		stopTone();
		const c = audio();
		const osc = c.createOscillator();
		const gain = c.createGain();
		osc.frequency.value = freq;
		gain.gain.value = 0;
		// Rampa suave: un arranque brusco produce un «clic» audible aunque el tono no lo sea.
		gain.gain.setTargetAtTime(volume / 100, c.currentTime, 0.05);
		osc.connect(gain).connect(c.destination);
		osc.start();
		tone = { osc, gain };
		toneLabel = `${(freq / 1000).toFixed(1)} kHz`;
	}

	/** Barrido 12 → 21 kHz en 18 s: anota a partir de cuándo dejas de oírlo. */
	function sweep() {
		playTone(12000);
		const c = audio();
		const t0 = c.currentTime;
		tone!.osc.frequency.setValueAtTime(12000, t0);
		tone!.osc.frequency.linearRampToValueAtTime(21000, t0 + 18);
		tone!.timer = setInterval(() => {
			const f = 12000 + Math.min(1, (c.currentTime - t0) / 18) * 9000;
			toneLabel = `barrido · ${(f / 1000).toFixed(1)} kHz`;
			if (c.currentTime - t0 > 18.5) stopTone();
		}, 100);
	}

	// ---------- 2. Emisor = perfil de sonido de este dispositivo ----------
	const initial = loadProfile();
	let saved = $state(initial);
	let protocol: ProtocolKey = $state(initial.protocol);
	let txVolume = $state(initial.volume);
	let highpassHz = $state(initial.highpassHz);
	let rampMs = $state(initial.rampMs);
	const current = (): SoundProfile => ({ protocol, volume: txVolume, highpassHz, rampMs });
	const dirty = $derived(
		protocol !== saved.protocol || txVolume !== saved.volume || highpassHz !== saved.highpassHz || rampMs !== saved.rampMs
	);
	let profileMsg = $state('');

	function save() {
		saveProfile(current());
		saved = current();
		profileMsg = 'Guardado: el emparejamiento de este dispositivo usará este sonido.';
	}
	function restore() {
		stopTx();
		saved = resetProfile();
		({ protocol, volume: txVolume, highpassHz, rampMs } = saved);
		profileMsg = 'Restablecido el sonido por defecto.';
	}

	let payloadKind: 'short' | 'key' = $state('short');
	let payload = $state(randomPayload('short'));
	let txOn = $state(false);
	let txCount = $state(0);
	let txDuration = $state(0);
	let txSource: AudioBufferSourceNode | null = null;
	let txLoop: ReturnType<typeof setTimeout> | null = null;
	let tx: { g: GGWave; inst: Instance } | null = null;

	async function encoder() {
		tx ??= await makeInstance(audio());
		return tx;
	}

	/** Reproduce un buffer una vez; se resuelve al terminar (o por tiempo, si `onended` no llega). */
	function playBuffer(buf: AudioBuffer) {
		const c = audio();
		return new Promise<void>((resolve) => {
			const src = c.createBufferSource();
			src.buffer = buf;
			src.connect(c.destination);
			const timer = setTimeout(resolve, buf.duration * 1000 + 400);
			src.onended = () => {
				clearTimeout(timer);
				resolve();
			};
			txSource = src;
			src.start();
		});
	}
	const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

	// Valoración de cada prueba: «¿lo oíste?», para comparar ajustes.
	type Trial = { at: number; profile: SoundProfile; rating: 'nada' | 'leve' | 'molesto' | '' };
	let trials: Trial[] = $state([]);
	const RATINGS = ['nada', 'leve', 'molesto'] as const;
	const describe = describeProfile;
	function rate(rating: Trial['rating']) {
		if (trials[0]) trials[0].rating = rating;
	}

	/** Misma señal dos veces: primero cruda (como antes) y luego suavizada con este perfil. */
	let comparing = $state('');
	async function compare() {
		error = '';
		stopTx();
		try {
			const c = audio();
			const { g, inst } = await encoder();
			payload ||= randomPayload(payloadKind);
			comparing = 'Sin suavizar…';
			await playBuffer(encodeToBuffer(c, g, inst, payload, protocol, txVolume));
			await sleep(1200);
			comparing = 'Suavizada (filtro + rampa)…';
			await playBuffer(encodeToBuffer(c, g, inst, payload, protocol, txVolume, current()));
		} catch (e) {
			err(e);
		}
		comparing = '';
	}

	async function startTx(once = false) {
		error = '';
		try {
			stopTx();
			const c = audio();
			const { g, inst } = await encoder();
			payload ||= randomPayload(payloadKind);
			const buf = encodeToBuffer(c, g, inst, payload, protocol, txVolume, current());
			txDuration = buf.duration;
			const trial: Trial = { at: Date.now(), profile: current(), rating: '' };
			trials = [trial, ...trials].slice(0, 12);
			txOn = true;
			txCount = 0;
			const play = () => {
				if (!txOn) return;
				const src = c.createBufferSource();
				src.buffer = buf;
				src.connect(c.destination);
				src.onended = () => {
					if (once) return void (txOn = false);
					txLoop = setTimeout(play, 1200); // pausa entre repeticiones
				};
				src.start();
				txSource = src;
				txCount++;
			};
			play();
		} catch (e) {
			err(e);
		}
	}

	function stopTx() {
		txOn = false;
		if (txLoop) clearTimeout(txLoop);
		try {
			txSource?.stop();
		} catch {
			/* ya terminó */
		}
		txSource = null;
	}

	function newPayload() {
		stopTx();
		payload = randomPayload(payloadKind);
	}

	// ---------- 4. Calibración del volumen (dos dispositivos) ----------
	// Uno emite niveles crecientes, el otro anota cuáles oyó y responde el volumen recomendado; el primero lo guarda.
	let calMode = $state<'' | 'emit' | 'listen'>('');
	let calStatus = $state('');
	let calHeard: number[] = $state([]);
	let calId = '';
	let calListener: Listener | null = null;
	let calTimer: ReturnType<typeof setTimeout> | undefined;
	const REPLY_VOLUME = 70; // la respuesta es una sola vez: que llegue

	function stopCal() {
		clearTimeout(calTimer);
		calListener?.stop();
		calListener = null;
		calMode = '';
	}

	async function calibrateEmit() {
		stopCal();
		stopTx();
		stopRx();
		error = '';
		const id = randomPayload('short').slice(0, 4);
		calHeard = [];
		calMode = 'emit';
		try {
			// Escuchar desde ya: la respuesta llega justo al terminar los niveles. Mis propios niveles se ignoran.
			calListener = await listen((t) => {
				const m = parseCal(t);
				if (m?.kind === 'r' && m.id === id && calMode === 'emit') finishEmit(m.volume);
			});
			const c = audio();
			const { g, inst } = await encoder();
			for (const v of CAL_LEVELS) {
				if (calMode !== 'emit') return;
				calStatus = `Emitiendo nivel ${v} de ${CAL_LEVELS.at(-1)}…`;
				await playBuffer(encodeToBuffer(c, g, inst, calMessage({ kind: 'v', volume: v, id }), protocol, v, current()));
				await sleep(700);
			}
			if (calMode !== 'emit') return;
			calStatus = 'En silencio: esperando el resultado del otro…';
			calTimer = setTimeout(() => {
				if (calMode !== 'emit') return;
				stopCal();
				calStatus = 'No llegó el resultado. Comprueba que el otro esté en «Calibrar: escucho» y acércalos.';
			}, 20000);
		} catch (e) {
			stopCal();
			err(e);
		}
	}

	function finishEmit(volume: number) {
		stopCal();
		if (!volume) {
			calStatus = 'El otro no oyó ningún nivel: acércalos, prueba otro modo o baja el filtro.';
			return;
		}
		txVolume = volume;
		save();
		calStatus = `Listo: volumen ${volume} guardado en este dispositivo (el mínimo que el otro oyó sin fallos, más un escalón de margen).`;
	}

	async function calibrateListen() {
		stopCal();
		stopTx();
		stopRx();
		error = '';
		calHeard = [];
		calId = '';
		calMode = 'listen';
		calStatus = 'Escuchando… en el otro dispositivo pulsa «Calibrar: emito».';
		try {
			calListener = await listen((t) => {
				const m = parseCal(t);
				if (!m || m.kind !== 'v' || calMode !== 'listen') return;
				if (calId && m.id !== calId) return;
				calId = m.id;
				if (!calHeard.includes(m.volume)) calHeard = [...calHeard, m.volume];
				calStatus = `Oído el nivel ${m.volume}…`;
				clearTimeout(calTimer);
				// Tras el último nivel, o si dejan de llegar (6 s > un nivel + pausa), respondo.
				if (m.volume === CAL_LEVELS.at(-1)) void reply();
				else calTimer = setTimeout(() => void reply(), 6000);
			});
		} catch (e) {
			stopCal();
			err(e);
		}
	}

	async function reply() {
		if (calMode !== 'listen') return;
		calListener?.stop();
		calListener = null;
		const v = recommendVolume(calHeard);
		calStatus = `Respondo al otro: volumen recomendado ${v || 'ninguno'}…`;
		try {
			const c = audio();
			const { g, inst } = await encoder();
			const buf = encodeToBuffer(c, g, inst, calMessage({ kind: 'r', volume: v, id: calId }), protocol, REPLY_VOLUME, current());
			for (let i = 0; i < 3 && calMode === 'listen'; i++) {
				await playBuffer(buf);
				await sleep(1500);
			}
			if (calMode === 'listen')
				calStatus = v
					? `Listo: el otro debería haber guardado volumen ${v}. Para la otra dirección, repite con los papeles al revés.`
					: 'No oí ningún nivel: acerca los dispositivos o prueba otro modo en el que emite.';
		} catch (e) {
			err(e);
		}
		calMode = '';
	}

	// ---------- 3. Receptor ----------
	type Got = { text: string; at: number; afterMs: number };
	let rxOn = $state(false);
	let received: Got[] = $state([]);
	let level = $state(-120); // dB en la banda 15-20 kHz
	let rxStart = 0;
	// El mismo receptor que el emparejamiento real (client/sync/audio.ts): AudioWorklet o, si falta, ScriptProcessor.
	let rx: Listener | null = null;
	let sampleRate = $state(0);
	let capture = $state('');

	async function startRx() {
		error = '';
		try {
			rx = await listen(
				(text) => (received = [{ text, at: Date.now(), afterMs: Date.now() - rxStart }, ...received].slice(0, 20)),
				(db) => (level = db)
			);
			sampleRate = rx.sampleRate;
			capture = rx.capture === 'worklet' ? 'AudioWorklet' : 'ScriptProcessor (respaldo)';
			rxStart = Date.now();
			rxOn = true;
		} catch (e) {
			err(e);
		}
	}

	function stopRx() {
		rx?.stop();
		rx = null;
		rxOn = false;
	}

	onDestroy(() => {
		stopTone();
		stopTx();
		stopRx();
		stopCal();
		void ctx?.close();
	});

	const pct = (db: number) => Math.max(0, Math.min(100, ((db + 120) / 90) * 100));
	const time = (t: number) => new Date(t).toLocaleTimeString('es');
</script>

<svelte:head><title>Laboratorio: ultrasonido · Sensei</title></svelte:head>

<div class="lab">
	<div class="row small"><a href="/sincronizar">← Sincronizar</a> <a href="/">Sensei</a></div>
	<h1>Laboratorio: emparejar por ultrasonido</h1>
	<p class="muted small">
		Experimento para decidir si se usa sonido (casi) inaudible para emparejar dispositivos. Abre esta página en dos dispositivos:
		uno <strong>emite</strong> un código y el otro lo <strong>escucha</strong>. No toca tus datos.
	</p>
	{#if error}<div class="error small">{error}</div>{/if}

	<section class="card stack">
		<h2>1. ¿Lo oyes? ¿Molesta?</h2>
		<p class="small muted">
			Empieza con volumen bajo. Los adultos suelen dejar de oír entre 15 y 18 kHz; niños y mascotas oyen más alto. Fíjate también en
			«clics» o zumbidos de los altavoces.
		</p>
		<label class="inline small">Volumen <input type="range" min="1" max="100" bind:value={volume} /> {volume}%</label>
		<div class="row">
			{#each [15000, 17000, 18000, 19000, 20000] as f (f)}
				<button class="small" onclick={() => playTone(f)}>{f / 1000} kHz</button>
			{/each}
			<button class="small" onclick={sweep}>Barrido 12 → 21 kHz</button>
			<button class="small ghost" onclick={stopTone} disabled={!toneLabel}>Parar</button>
		</div>
		<p class="small warn-text">
			⚠ Son tonos <strong>continuos</strong> en una sola frecuencia: a 15-17 kHz pueden molestar mucho más que la emisión real (que salta
			entre frecuencias y dura poco). Empieza con volumen bajo y súbelo de a poco.
		</p>
		{#if toneLabel}<p class="small">Sonando: <strong>{toneLabel}</strong></p>{/if}
		<p class="small dim">
			La transmisión real (abajo) usa la banda de 15-19,5 kHz y salta de tono en tono: esos saltos son lo que más se oye. Pruébala con
			«Emitir una vez» o «Comparar».
		</p>
	</section>

	<div class="two">
		<section class="card stack">
			<h2>2. Emisor · sonido de este dispositivo</h2>
			<p class="small muted">
				Lo que ajustes aquí y guardes lo usa el emparejamiento de <strong>este</strong> dispositivo al emitir. Cada uno tiene el suyo.
			</p>
			<label class="small"
				>Modo
				<select bind:value={protocol} onchange={stopTx}>
					{#each Object.entries(PROTOCOLS) as [k, p] (k)}<option value={k}>{p.label}</option>{/each}
				</select>
			</label>
			<label class="inline small"
				>Filtro paso-alto
				<input type="range" min="0" max="15000" step="500" bind:value={highpassHz} onchange={stopTx} />
				{highpassHz ? `${(highpassHz / 1000).toFixed(1)} kHz` : 'no'}
			</label>
			<label class="inline small"
				>Rampa <input type="range" min="0" max="150" step="10" bind:value={rampMs} onchange={stopTx} />
				{rampMs ? `${rampMs} ms` : 'no'}
			</label>
			<p class="small dim">
				El filtro quita lo audible bajo la banda (14 kHz recomendado; por encima de 15 kHz empieza a recortar la señal). La rampa evita el
				clic al empezar y terminar. No se aplican al modo audible.
			</p>
			<label class="small"
				>Contenido
				<select
					bind:value={payloadKind}
					onchange={() => {
						stopTx();
						payload = randomPayload(payloadKind);
					}}
				>
					<option value="short">Código corto (6 caracteres)</option>
					<option value="key">Clave real de emparejamiento (43 caracteres)</option>
				</select>
			</label>
			<label class="inline small">Volumen <input type="range" min="5" max="100" bind:value={txVolume} onchange={stopTx} /> {txVolume}</label>
			<div class="code jp">{payload || '—'}</div>
			<div class="row">
				{#if txOn}
					<button class="primary" onclick={stopTx}>Parar</button>
				{:else}
					<button class="primary" onclick={() => startTx()}>Emitir en bucle</button>
					<button onclick={() => startTx(true)}>Emitir una vez</button>
					<button onclick={compare} disabled={!!comparing || protocol.startsWith('audible')}>Comparar: cruda → suavizada</button>
				{/if}
				<button class="ghost small" onclick={newPayload}>Nuevo código</button>
			</div>
			{#if comparing}<p class="small">Sonando: <strong>{comparing}</strong></p>{/if}
			{#if txDuration}<p class="small dim">Cada emisión dura {txDuration.toFixed(1)} s{#if txOn} · enviadas: {txCount}{/if}.</p>{/if}
			{#if trials[0]}
				<div class="row small">
					¿Lo oíste?
					{#each RATINGS as r (r)}
						<button class="small" class:primary={trials[0].rating === r} onclick={() => rate(r)}>{r}</button>
					{/each}
				</div>
			{/if}
			<div class="row">
				<button class="primary small" onclick={save} disabled={!dirty}>Guardar como sonido de este dispositivo</button>
				<button class="ghost small" onclick={restore}>Restablecer</button>
			</div>
			{#if profileMsg}<p class="small ok-text">{profileMsg}</p>{/if}
			{#if dirty}<p class="small dim">Sin guardar. Guardado: {describe(saved)}.</p>{/if}
			{#if trials.length}
				<details class="small" open>
					<summary>Pruebas ({trials.length})</summary>
					<ul class="trials">
						{#each trials as t (t.at)}
							<li>
								<span class="dim">{time(t.at)}</span> {describe(t.profile)} · <strong>{t.rating || 'sin valorar'}</strong>
							</li>
						{/each}
					</ul>
				</details>
			{/if}
		</section>

		<section class="card stack">
			<h2>3. Receptor</h2>
			<p class="small muted">Pide permiso de micrófono. Acerca los dispositivos (menos de 1 m) en un sitio tranquilo.</p>
			<div class="row">
				{#if rxOn}
					<button class="primary" onclick={stopRx}>Dejar de escuchar</button>
				{:else}
					<button class="primary" onclick={startRx}>Escuchar</button>
				{/if}
				{#if received.length}<button class="ghost small" onclick={() => (received = [])}>Limpiar</button>{/if}
			</div>
			{#if rxOn}
				<div class="small">Energía 15-20 kHz: {level.toFixed(0)} dB</div>
				<div class="meter" role="meter" aria-label="Energía ultrasónica captada" aria-valuemin="-120" aria-valuemax="-30" aria-valuenow={Math.round(level)}>
					<div style="width:{pct(level)}%"></div>
				</div>
				<p class="small dim">
					Muestreo {sampleRate / 1000} kHz · captura: {capture}. Si la barra no sube cuando el otro emite, este micrófono (o el altavoz del otro) filtra el
					ultrasonido.
				</p>
			{/if}
			{#each received as r (r.at)}
				<div class="got">
					<span class="code jp">{r.text}</span>
					<span class="small dim">{time(r.at)} · tras {(r.afterMs / 1000).toFixed(1)} s escuchando</span>
				</div>
			{:else}
				{#if rxOn}<p class="small muted">Esperando… (aún nada recibido)</p>{/if}
			{/each}
		</section>
	</div>

	<section class="card stack">
		<h2>4. Calibrar el volumen (automático)</h2>
		<p class="small muted">
			Busca el volumen más bajo que el otro dispositivo oye sin fallos. En este pulsa «Calibrar: emito» y en el otro «Calibrar: escucho»:
			este emite {CAL_LEVELS.length} niveles ({CAL_LEVELS[0]} → {CAL_LEVELS.at(-1)}, ~25 s) con el modo, filtro y rampa de arriba, y el
			otro responde el recomendado, que se guarda aquí. Luego repite con los papeles al revés para la otra dirección.
		</p>
		<div class="row">
			{#if calMode}
				<button class="ghost" onclick={stopCal}>Cancelar</button>
			{:else}
				<button class="primary" onclick={calibrateEmit}>Calibrar: emito</button>
				<button onclick={calibrateListen}>Calibrar: escucho</button>
			{/if}
		</div>
		{#if calStatus}<p class="small">{calStatus}</p>{/if}
		{#if calHeard.length || calMode === 'listen'}
			<div class="levels" aria-label="Niveles oídos">
				{#each CAL_LEVELS as l (l)}<span class:on={calHeard.includes(l)}>{l}</span>{/each}
			</div>
		{/if}
		<p class="small dim">
			Por defecto: {describe(DEFAULT_PROFILE)}. Ahora guardado: {describe(saved)}.
		</p>
	</section>

	<section class="card small stack">
		<h2>Qué anotar</h2>
		<ul>
			<li>A partir de qué frecuencia dejas de oír el tono, y si la transmisión ultrasónica se nota.</li>
			<li>Si llega el código, en qué modo, a qué distancia y cuánto tardó (PC → móvil y móvil → PC).</li>
			<li>Modelo de cada dispositivo y navegador.</li>
		</ul>
	</section>
</div>

<style>
	.lab {
		max-width: 900px;
		margin: 0 auto;
		padding: 1.2rem 1rem 3rem;
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}
	.two {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
		gap: 1rem;
	}
	.inline {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin: 0;
	}
	.inline input {
		flex: 1;
	}
	select {
		width: 100%;
	}
	.code {
		font-family: ui-monospace, monospace;
		font-size: 1.3rem;
		letter-spacing: 0.08em;
		word-break: break-all;
		padding: 0.5rem 0.7rem;
		background: var(--bg-3);
		border-radius: var(--radius-sm);
	}
	.meter {
		height: 10px;
		border-radius: 999px;
		background: var(--bg-3);
		overflow: hidden;
	}
	.meter div {
		height: 100%;
		background: var(--series-1);
		transition: width 0.08s linear;
	}
	.got {
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
	}
	.got .code {
		font-size: 1rem;
		border-left: 3px solid var(--ok);
	}
	ul {
		margin: 0;
		padding-left: 1.2rem;
	}
	.trials li {
		margin: 0.15rem 0;
	}
	.levels {
		display: flex;
		flex-wrap: wrap;
		gap: 0.3rem;
	}
	.levels span {
		font-family: ui-monospace, monospace;
		font-size: 0.85rem;
		padding: 0.15rem 0.45rem;
		border-radius: var(--radius-sm);
		background: var(--bg-3);
		color: var(--text-3);
	}
	.levels span.on {
		background: var(--ok);
		color: #fff;
	}
	.ok-text {
		color: var(--ok);
	}
	.warn-text {
		color: var(--warn);
	}
</style>
