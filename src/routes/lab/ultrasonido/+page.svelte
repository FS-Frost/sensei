<script lang="ts">
	// Laboratorio: ¿se oye el ultrasonido? ¿se emparejan dos dispositivos por sonido? (experimento, ver docs/sync-qr.md)
	import { onDestroy } from 'svelte';
	import type { GGWave, Instance } from 'ggwave';
	import { decodeChunk, encodeToBuffer, makeInstance, PROTOCOLS, randomPayload, type ProtocolKey } from '#lib/client/sound.ts';

	let ctx: AudioContext | null = null;
	function audio() {
		ctx ??= new AudioContext();
		if (ctx.state === 'suspended') void ctx.resume();
		return ctx;
	}

	let error = $state('');
	const err = (e: unknown) => (error = e instanceof Error ? e.message : String(e));

	// ---------- 1. ¿Molesta? ----------
	let volume = $state(30);
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

	// ---------- 2. Emisor ----------
	let protocol: ProtocolKey = $state('ultra_fast');
	let payloadKind: 'short' | 'key' = $state('short');
	let txVolume = $state(50);
	let payload = $state(randomPayload('short'));
	let txOn = $state(false);
	let txCount = $state(0);
	let txDuration = $state(0);
	let txSource: AudioBufferSourceNode | null = null;
	let txLoop: ReturnType<typeof setTimeout> | null = null;
	let tx: { g: GGWave; inst: Instance } | null = null;

	async function startTx(once = false) {
		error = '';
		try {
			stopTx();
			const c = audio();
			tx ??= await makeInstance(c);
			payload ||= randomPayload(payloadKind);
			const buf = encodeToBuffer(c, tx.g, tx.inst, payload, protocol, txVolume);
			txDuration = buf.duration;
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

	// ---------- 3. Receptor ----------
	type Got = { text: string; at: number; afterMs: number };
	let rxOn = $state(false);
	let received: Got[] = $state([]);
	let level = $state(-120); // dB en la banda 17-21 kHz
	let rxStart = 0;
	let rx: {
		stream: MediaStream;
		node: ScriptProcessorNode;
		analyser: AnalyserNode;
		raf: number;
		g: GGWave;
		inst: Instance;
	} | null = null;
	let sampleRate = $state(0);

	async function startRx() {
		error = '';
		try {
			const c = audio();
			// Sin procesado: la cancelación de eco y el control de ganancia borran los tonos.
			const stream = await navigator.mediaDevices.getUserMedia({
				audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
			});
			const { g, inst } = await makeInstance(c);
			const src = c.createMediaStreamSource(stream);
			const node = c.createScriptProcessor(1024, 1, 1);
			const analyser = c.createAnalyser();
			analyser.fftSize = 4096;
			node.onaudioprocess = (e) => {
				const text = decodeChunk(g, inst, e.inputBuffer.getChannelData(0));
				if (text) received = [{ text, at: Date.now(), afterMs: Date.now() - rxStart }, ...received].slice(0, 20);
			};
			// ScriptProcessor solo procesa si está conectado a la salida: pasa por una ganancia 0 (silencio).
			const mute = c.createGain();
			mute.gain.value = 0;
			src.connect(node).connect(mute).connect(c.destination);
			src.connect(analyser);
			const bins = new Float32Array(analyser.frequencyBinCount);
			const hz = c.sampleRate / analyser.fftSize;
			const meter = () => {
				analyser.getFloatFrequencyData(bins);
				let max = -140;
				for (let i = Math.floor(17000 / hz); i < Math.min(bins.length, Math.ceil(21000 / hz)); i++) max = Math.max(max, bins[i]);
				level = max;
				rx!.raf = requestAnimationFrame(meter);
			};
			rx = { stream, node, analyser, raf: requestAnimationFrame(meter), g, inst };
			sampleRate = c.sampleRate;
			rxStart = Date.now();
			rxOn = true;
		} catch (e) {
			err(e);
		}
	}

	function stopRx() {
		if (!rx) return;
		cancelAnimationFrame(rx.raf);
		rx.node.disconnect();
		rx.stream.getTracks().forEach((t) => t.stop());
		rx.g.free(rx.inst);
		rx = null;
		rxOn = false;
	}

	onDestroy(() => {
		stopTone();
		stopTx();
		stopRx();
		void ctx?.close();
	});

	const pct = (db: number) => Math.max(0, Math.min(100, ((db + 120) / 90) * 100));
	const time = (t: number) => new Date(t).toLocaleTimeString('es');
</script>

<svelte:head><title>Laboratorio: ultrasonido · Sensei</title></svelte:head>

<div class="lab">
	<a href="/" class="small">← Sensei</a>
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
		{#if toneLabel}<p class="small">Sonando: <strong>{toneLabel}</strong></p>{/if}
		<p class="small dim">La transmisión real del emisor (abajo) usa la banda de ~18-20 kHz: pruébala también con «Emitir una vez».</p>
	</section>

	<div class="two">
		<section class="card stack">
			<h2>2. Emisor</h2>
			<label class="small"
				>Modo
				<select bind:value={protocol} onchange={stopTx}>
					{#each Object.entries(PROTOCOLS) as [k, p] (k)}<option value={k}>{p.label}</option>{/each}
				</select>
			</label>
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
				{/if}
				<button class="ghost small" onclick={newPayload}>Nuevo código</button>
			</div>
			{#if txDuration}<p class="small dim">Cada emisión dura {txDuration.toFixed(1)} s{#if txOn} · enviadas: {txCount}{/if}.</p>{/if}
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
				<div class="small">Energía 17-21 kHz: {level.toFixed(0)} dB</div>
				<div class="meter" role="meter" aria-label="Energía ultrasónica captada" aria-valuemin="-120" aria-valuemax="-30" aria-valuenow={Math.round(level)}>
					<div style="width:{pct(level)}%"></div>
				</div>
				<p class="small dim">
					Muestreo {sampleRate / 1000} kHz. Si la barra no sube cuando el otro emite, este micrófono (o el altavoz del otro) filtra el
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
</style>
