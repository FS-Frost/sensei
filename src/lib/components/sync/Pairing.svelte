<script lang="ts">
	// Emparejar dos dispositivos por la red local: señas compactas por SONIDO (principal) o QR / texto (respaldo).
	// Al conectar, entrega el canal WebRTC abierto con `onconnected`. Ver docs/sync-qr.md.
	import { onDestroy, onMount } from 'svelte';
	import { acceptOffer, bindingFor, codeFor, connectAnswer, createOffer, type Connected } from '../../client/sync/rtc.ts';
	import { decode, PREFIX, type Signal } from '../../client/sync/signal.ts';
	import { createEmitter, listen, type Emitter, type Listener } from '../../client/sync/audio.ts';
	import { qrSvg, scanQr } from '../../client/sync/qr.ts';
	import { base } from '../../client/base.ts';
	import type { ProtocolKey } from '../../client/sound.ts';

	let {
		onconnected,
		offerFromLink = null,
		linkPath = '/sincronizar'
	}: {
		onconnected: (c: Connected) => void;
		offerFromLink?: string | null;
		/** Página que abre el QR de la oferta al escanearlo con la cámara del sistema. */
		linkPath?: string;
	} = $props();

	type Mode = 'idle' | 'offering' | 'joining' | 'answering' | 'connecting' | 'connected';
	let mode = $state<Mode>('idle');
	let error = $state('');
	let myText = $state('');
	let qr = $state('');
	let level = $state(-140);
	let heard = $state(false);
	let micError = $state('');
	let protocol: ProtocolKey = $state('ultra_fast');
	let pasted = $state('');
	let scanning = $state(false);
	let video: HTMLVideoElement | undefined = $state();
	let scanAbort: AbortController | null = null;
	let emitter = $state.raw<Emitter | null>(null);
	let listener = $state.raw<Listener | null>(null);
	let offer: Awaited<ReturnType<typeof createOffer>> | null = null;
	let started = 0;
	let elapsed = $state(0);
	let tick: ReturnType<typeof setInterval> | null = null;

	function stopAudio() {
		emitter?.stop();
		emitter = null;
		listener?.stop();
		listener = null;
	}

	function reset() {
		stopAudio();
		scanAbort?.abort();
		scanning = false;
		if (tick) clearInterval(tick);
		offer?.pc.close();
		offer = null;
		mode = 'idle';
		myText = qr = pasted = error = micError = '';
		heard = false;
	}

	function err(e: unknown) {
		error = e instanceof Error ? e.message : String(e);
	}

	// El sonido es semidúplex: si ambos emiten a la vez en la misma banda, se tapan. Turnos:
	// - el iniciador emite su oferta y luego CALLA escuchando (ventana = duración + margen), y repite;
	// - quien se une responde justo al terminar de oír la oferta, es decir, dentro de ese silencio.
	let phase = $state<'emit' | 'listen' | ''>('');
	const MARGIN_MS = 5000; // tiempo para que el otro cree la respuesta y empiece a emitir

	async function makeEmitter(text: string) {
		try {
			emitter = await createEmitter(text, protocol);
			return emitter;
		} catch (e) {
			micError = `No se pudo emitir sonido (${e instanceof Error ? e.message : e}). Usa el QR o el código.`;
			return null;
		}
	}

	const sleepWhile = (ms: number, alive: () => boolean) =>
		new Promise<void>((resolve) => {
			const end = Date.now() + ms;
			const t = setInterval(() => {
				if (!alive() || Date.now() >= end) {
					clearInterval(t);
					resolve();
				}
			}, 100);
		});

	/** Iniciador: emitir una vez → callar escuchando → repetir, hasta recibir la respuesta. */
	async function offerCycle(em: Emitter) {
		const alive = () => mode === 'offering' && emitter === em;
		while (alive()) {
			phase = 'emit';
			await em.playOnce();
			if (!alive()) break;
			phase = 'listen';
			await sleepWhile(em.duration * 1000 + MARGIN_MS, alive);
		}
		phase = '';
	}

	let lastAnswerAt = 0;
	/** Quien se une: responde en el silencio que deja el iniciador tras cada oferta oída. */
	function answerNow() {
		const em = emitter;
		if (!em || em.playing || mode !== 'answering' || Date.now() - lastAnswerAt < 2000) return;
		lastAnswerAt = Date.now();
		phase = 'emit';
		void em.playOnce().then(() => {
			if (emitter === em) phase = 'listen';
		});
	}

	/** Escucha señas del otro: `want` = rol esperado ('o' oferta, 'a' respuesta). */
	async function startListen(want: 'o' | 'a', onSignal: (text: string) => void) {
		try {
			listener = await listen(
				(t) => {
					if (!t.startsWith(PREFIX + '~')) return;
					let s: Signal;
					try {
						s = decode(t);
					} catch {
						return;
					}
					const isOffer = s.role === 'o';
					if ((want === 'o') !== isOffer) return; // p. ej. mi propia oferta oída por mi micrófono
					heard = true;
					onSignal(t);
				},
				(db) => (level = db)
			);
		} catch (e) {
			micError = `Sin micrófono (${e instanceof Error ? e.message : e}): usa el QR o pega el código.`;
		}
	}

	function startClock() {
		started = Date.now();
		tick = setInterval(() => (elapsed = Math.floor((Date.now() - started) / 1000)), 500);
	}

	// ---------- Iniciar (emite la oferta, espera la respuesta) ----------
	async function start() {
		reset();
		mode = 'offering';
		startClock();
		try {
			// Micrófono ANTES de la oferta: con el permiso concedido, el navegador expone la IP local real
			// en lugar del nombre mDNS «.local» (que en algunas redes no se resuelve).
			await startListen('a', (t) => void gotAnswer(t));
			offer = await createOffer();
			myText = offer.signal;
			qr = qrSvg(`${location.origin}${base}${linkPath}#s=${encodeURIComponent(offer.signal)}`);
			const em = await makeEmitter(offer.signal);
			if (em) void offerCycle(em);
		} catch (e) {
			err(e);
		}
	}

	let finishing = false;
	async function gotAnswer(text: string) {
		if (!offer || finishing) return;
		finishing = true;
		mode = 'connecting';
		stopAudio();
		try {
			const { channel, theirs } = await connectAnswer(offer, text);
			const code = await codeFor(offer.mine, theirs);
			mode = 'connected';
			if (tick) clearInterval(tick);
			// La conexión pasa a quien la pidió: que la limpieza de este componente (al desmontarse) no la cierre.
			const link = offer;
			offer = null;
			onconnected({ channel, pc: link.pc, initiator: true, code, binding: bindingFor(link.mine, theirs) });
		} catch (e) {
			finishing = false;
			mode = 'offering';
			err(e);
		}
	}

	// ---------- Unirme (escucha la oferta, emite la respuesta) ----------
	async function join() {
		reset();
		mode = 'joining';
		startClock();
		await startListen('o', onOfferHeard);
	}

	/** Cada vez que se oye la oferta (= el iniciador acaba de terminar de emitir). */
	function onOfferHeard(t: string) {
		if (mode === 'joining') void gotOffer(t);
		else if (mode === 'answering') answerNow();
	}

	async function gotOffer(text: string) {
		if (mode !== 'joining' && mode !== 'idle') return;
		mode = 'answering';
		try {
			// Llegó por QR, pegado o enlace: escuchar igualmente para responder en los silencios del iniciador
			// (y conceder el micrófono antes de crear la respuesta: así se usa la IP local real).
			if (!listener) await startListen('o', onOfferHeard);
			const ans = await acceptOffer(text);
			myText = ans.signal;
			qr = qrSvg(ans.signal);
			if (await makeEmitter(ans.signal)) answerNow(); // la oferta acaba de terminar: el iniciador calla ahora
			const channel = await ans.channel();
			stopAudio();
			const code = await codeFor(ans.mine, ans.theirs);
			mode = 'connected';
			if (tick) clearInterval(tick);
			onconnected({ channel, pc: ans.pc, initiator: false, code, binding: bindingFor(ans.mine, ans.theirs) });
		} catch (e) {
			stopAudio();
			mode = 'joining';
			err(e);
		}
	}

	// ---------- Respaldo: pegar o escanear ----------
	function usePasted() {
		const t = pasted.trim().replace(/^.*#s=/, '');
		const text = decodeURIComponent(t);
		error = '';
		try {
			const s = decode(text);
			if (s.role === 'o') void gotOffer(text);
			else void gotAnswer(text);
		} catch (e) {
			err(e);
		}
	}

	async function scan() {
		scanning = true;
		scanAbort = new AbortController();
		try {
			const raw = await scanQr(video!, scanAbort.signal);
			scanning = false;
			pasted = raw;
			usePasted();
		} catch (e) {
			scanning = false;
			if ((e as DOMException).name !== 'AbortError') err(e);
		}
	}

	function setProtocol(p: ProtocolKey) {
		protocol = p;
		emitter?.setProtocol(p);
	}

	async function copy() {
		await navigator.clipboard.writeText(myText).catch(() => {});
	}

	onMount(() => {
		if (offerFromLink) void gotOffer(offerFromLink);
	});
	onDestroy(reset);

	const pct = (db: number) => Math.max(0, Math.min(100, ((db + 120) / 90) * 100));
	const waitingFor = $derived(mode === 'offering' ? 'respuesta' : mode === 'joining' ? 'código' : '');
</script>

<div class="pairing stack">
	{#if error}<div class="error small">{error}</div>{/if}

	{#if mode === 'idle'}
		<div class="two">
			<button class="primary big" onclick={start}>
				<strong>Iniciar</strong><span class="small">este dispositivo emite el código</span>
			</button>
			<button class="big" onclick={join}>
				<strong>Unirme</strong><span class="small">escucho o escaneo el código del otro</span>
			</button>
		</div>
		<p class="small dim">
			Pulsa «Iniciar» en uno y «Unirme» en el otro. Se emparejan por sonido (o QR) y los datos viajan por tu red local: no hace falta
			internet, solo estar en la misma WiFi.
		</p>
	{:else if mode === 'connecting'}
		<p><span class="spinner"></span> Conectando por la red local…</p>
	{:else if mode === 'connected'}
		<p class="ok-text">✓ Conectados por la red local.</p>
	{:else}
		<div class="steps small">
			<span class:on={mode === 'offering' || mode === 'answering'}>
				{mode === 'answering' ? '2. Emitiendo mi respuesta' : '1. Emitiendo mi código'}
			</span>
			<span class:on={mode === 'offering' || mode === 'joining'}>
				{mode === 'joining' ? '1. Escuchando el código del otro' : mode === 'offering' ? '2. Escuchando la respuesta' : ''}
			</span>
		</div>

		{#if myText}
			<div class="emit">
				<div class="qr" aria-label="Código QR">{@html qr}</div>
				<div class="stack">
					<p class="small">
						{#if !emitter}Sin sonido
						{:else if phase === 'emit'}<strong>🔊 Emitiendo{mode === 'answering' ? ' mi respuesta' : ' mi código'}…</strong>
						{:else if mode === 'offering'}<strong>🤫 En silencio: escuchando la respuesta</strong> (vuelvo a emitir en unos segundos)
						{:else}Respondo cada vez que el otro termina de emitir{/if}
					</p>
					<p class="small dim">
						{#if mode === 'offering'}En el otro dispositivo pulsa «Unirme» (o escanea este QR con su cámara). Se turnan: uno emite mientras el otro calla.{:else}Mantén los dispositivos cerca (menos de 1 m). Si el otro no la oye, que escanee este QR.{/if}
					</p>
					<label class="inline small"
						>Modo
						<select value={protocol} onchange={(e) => setProtocol((e.target as HTMLSelectElement).value as ProtocolKey)}>
							<option value="ultra_fast">Ultrasonido</option>
							<option value="ultra_fastest">Ultrasonido · máximo</option>
							<option value="audible_fast">Audible (más robusto)</option>
						</select>
					</label>
					<details class="small">
						<summary>Ver código en texto</summary>
						<code class="code">{myText}</code>
						<button class="small" onclick={copy}>Copiar</button>
					</details>
				</div>
			</div>
		{/if}

		{#if waitingFor}
			<div class="listen stack">
				<p class="small">
					{#if listener}🎙 Escuchando la {waitingFor}… {elapsed} s{:else}Esperando la {waitingFor}{/if}
					{#if heard}· recibida{/if}
				</p>
				{#if listener}
					<div class="meter" role="meter" aria-label="Energía ultrasónica" aria-valuemin="-120" aria-valuemax="-30" aria-valuenow={Math.round(level)}>
						<div style="width:{pct(level)}%"></div>
					</div>
					{#if mode === 'offering'}
						<p class="small dim">
							Mientras emito, la barra sube por mi propio sonido. En el silencio, debería subir cuando el otro responda.
						</p>
					{/if}
				{/if}
				{#if micError}<p class="small warn-text">{micError}</p>{/if}
				{#if elapsed > 25 && !heard && listener}
					<p class="small dim">
						¿No llega? Acerca los dispositivos, cambia el modo del que emite a «Ultrasonido · máximo» o «Audible», o usa el QR (en
						el otro, «📷 Escanear QR»).
					</p>
				{/if}
				<div class="row">
					{#if scanning}
						<button class="small ghost" onclick={() => scanAbort?.abort()}>Cancelar escaneo</button>
					{:else}
						<button class="small" onclick={scan}>📷 Escanear QR</button>
					{/if}
				</div>
				<!-- svelte-ignore a11y_media_has_caption -->
				<video bind:this={video} class:hidden={!scanning} playsinline muted></video>
				<div class="row">
					<input class="grow" bind:value={pasted} placeholder="…o pega el código del otro (S2~…)" aria-label="Código del otro dispositivo" />
					<button class="small" onclick={usePasted} disabled={!pasted.trim()}>Usar</button>
				</div>
			</div>
		{/if}
		<div><button class="ghost small" onclick={reset}>Cancelar</button></div>
	{/if}
</div>

<style>
	.two {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
		gap: 0.8rem;
	}
	.big {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 0.2rem;
		padding: 0.9rem 1rem;
		text-align: left;
	}
	.steps {
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
		color: var(--text-3);
	}
	.steps .on {
		color: var(--text);
	}
	.emit {
		display: flex;
		gap: 1rem;
		align-items: flex-start;
		flex-wrap: wrap;
	}
	.qr {
		width: 190px;
		height: 190px;
		background: #fff;
		border-radius: var(--radius-sm);
		padding: 6px;
		flex-shrink: 0;
	}
	.qr :global(svg) {
		width: 100%;
		height: 100%;
		display: block;
	}
	.emit .stack {
		flex: 1;
		min-width: 200px;
	}
	.code {
		display: block;
		word-break: break-all;
		margin: 0.4rem 0;
		font-size: 0.8rem;
	}
	.inline {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin: 0;
	}
	.inline select {
		width: auto;
	}
	.meter {
		height: 8px;
		border-radius: 999px;
		background: var(--bg-3);
		overflow: hidden;
	}
	.meter div {
		height: 100%;
		background: var(--series-1);
		transition: width 0.08s linear;
	}
	video {
		width: 100%;
		max-width: 320px;
		border-radius: var(--radius-sm);
	}
	.hidden {
		display: none;
	}
	.grow {
		flex: 1;
		min-width: 0;
	}
	.ok-text {
		color: var(--ok);
	}
	.warn-text {
		color: var(--warn);
	}
</style>
