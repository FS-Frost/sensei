<script lang="ts">
	// Emparejar dos dispositivos por la red local. Tras «Iniciar»/«Unirme» se pregunta SIEMPRE el método:
	// QR + SONIDO (el móvil escanea y responde por ultrasonido: solo emite uno, sin turnos), SONIDO (ultrasonido, por turnos),
	// QR (cada uno escanea el del otro) o COPIAR Y PEGAR (sin permisos).
	// Al conectar, entrega el canal WebRTC abierto con `onconnected`. Ver docs/sync-qr.md.
	import { onDestroy, tick, untrack } from 'svelte';
	import { acceptOffer, bindingFor, codeFor, connectAnswer, createOffer, type Connected } from '../../client/sync/rtc.ts';
	import { decode, PREFIX, type Signal } from '../../client/sync/signal.ts';
	import { audioContext, createEmitter, listen, type Emitter, type Listener } from '../../client/sync/audio.ts';
	import { qrSvg, scanQr } from '../../client/sync/qr.ts';
	import { toast } from '../../client/toast.svelte.ts';
	import { base } from '../../client/base.ts';
	import { loadProfile, type ProtocolKey } from '../../client/sound.ts';

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

	type Method = 'qrsound' | 'sound' | 'qr' | 'paste';
	const RECOMMENDED: Method = 'qrsound';
	const METHODS: { key: Method; icon: string; label: string; hint: string }[] = [
		{
			key: 'qrsound',
			icon: '📷🔊',
			label: 'QR + sonido',
			hint: 'Ideal PC ↔ móvil: el móvil escanea el QR del PC y responde por ultrasonido. Inicia el PC (solo necesita micrófono).'
		},
		{ key: 'sound', icon: '🔊', label: 'Sonido', hint: 'Los dos por ultrasonido, por turnos. Pide el micrófono en ambos.' },
		{ key: 'qr', icon: '📷', label: 'QR', hint: 'Cada uno escanea el QR del otro. Pide la cámara (el PC necesita webcam).' },
		{ key: 'paste', icon: '⌨', label: 'Copiar y pegar', hint: 'Pasa el código por un chat o una nota. Sin permisos.' }
	];

	type Mode = 'idle' | 'choose' | 'offering' | 'joining' | 'answering' | 'connecting' | 'connected';
	let mode = $state<Mode>('idle');
	let role = $state<'init' | 'join'>('init');
	let method = $state<Method>(RECOMMENDED); // se pregunta siempre (no se recuerda)
	// QR abierto con la cámara del sistema: «#s=<oferta>&m=qs» si el otro espera la respuesta por sonido.
	// Se lee al crear el componente, antes de que la página limpie el hash.
	const linkMethod: Method = typeof location !== 'undefined' && /[#&]m=qs\b/.test(location.hash) ? 'qrsound' : 'qr';
	let myText = $state('');
	let qr = $state('');
	let level = $state(-140);
	let heard = $state(false);
	let micError = $state('');
	let camError = $state('');
	let copied = $state(false);
	let needsTap = $state(false);
	let protocol: ProtocolKey = $state(loadProfile().protocol);
	let pasted = $state('');
	let scanning = $state(false);
	let video: HTMLVideoElement | undefined = $state();
	let scanAbort: AbortController | null = null;
	let emitter = $state.raw<Emitter | null>(null);
	let listener = $state.raw<Listener | null>(null);
	let offer: Awaited<ReturnType<typeof createOffer>> | null = null;
	let started = 0;
	let elapsed = $state(0);
	let timer: ReturnType<typeof setInterval> | null = null;

	function stopCapture() {
		emitter?.stop();
		emitter = null;
		listener?.stop();
		listener = null;
		scanAbort?.abort();
		scanAbort = null;
		scanning = false;
	}

	function reset() {
		stopCapture();
		if (timer) clearInterval(timer);
		offer?.pc.close();
		offer = null;
		finishing = false;
		mode = 'idle';
		myText = qr = pasted = micError = camError = '';
		heard = copied = needsTap = false;
	}

	function err(e: unknown) {
		const msg = e instanceof Error ? e.message : String(e);
		// Sin permiso de micrófono ni cámara, el navegador oculta la IP local tras un nombre «.local» que algunas redes no resuelven.
		toast.error(msg, {
			detail:
				method === 'paste' && /red local|no se conectó/.test(msg)
					? 'Con «Copiar y pegar» el navegador oculta la IP local (no hay permiso de micrófono ni cámara) y algunas redes no la resuelven: prueba con sonido o QR.'
					: undefined,
			key: 'pairing'
		});
	}

	function startClock() {
		started = Date.now();
		elapsed = 0;
		timer = setInterval(() => (elapsed = Math.floor((Date.now() - started) / 1000)), 500);
	}

	// ---------- Sonido: semidúplex, por turnos ----------
	// Si ambos emiten a la vez en la misma banda, se tapan:
	// - el iniciador emite su oferta y luego CALLA escuchando (ventana = duración + margen), y repite;
	// - quien se une responde justo al terminar de oír la oferta, es decir, dentro de ese silencio.
	let phase = $state<'emit' | 'listen' | ''>('');
	const MARGIN_MS = 5000; // tiempo para que el otro cree la respuesta y empiece a emitir

	async function makeEmitter(text: string) {
		try {
			// Releer al emitir: el perfil pudo cambiar en el laboratorio (otra pestaña).
			emitter = await createEmitter(text, { ...loadProfile(), protocol });
			return emitter;
		} catch (e) {
			micError = `No se pudo emitir sonido (${e instanceof Error ? e.message : e}). Cambia a QR o a copiar y pegar.`;
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

	/** QR + sonido: solo emite quien se une (el otro solo escucha), así que no hay turnos: repetir con una pausa. */
	async function answerLoop(em: Emitter) {
		const alive = () => mode === 'answering' && emitter === em;
		while (alive()) {
			phase = 'emit';
			await em.playOnce();
			if (!alive()) break;
			phase = 'listen';
			await sleepWhile(1500, alive);
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
					if ((want === 'o') !== (s.role === 'o')) return; // p. ej. mi propia oferta oída por mi micrófono
					heard = true;
					onSignal(t);
				},
				(db) => (level = db)
			);
		} catch (e) {
			micError = `Sin micrófono (${e instanceof Error ? e.message : e}): cambia a QR o a copiar y pegar.`;
		}
	}

	// ---------- QR: escanear con la cámara ----------
	/** Abre la cámara y escanea; se resuelve cuando la cámara ya está abierta (o falló), no al leer. */
	async function startScan() {
		await tick(); // el <video> aparece al cambiar de modo
		return new Promise<void>((ready) => {
			if (!video) return ready();
			scanning = true;
			camError = '';
			const ctl = (scanAbort = new AbortController());
			scanQr(video, ctl.signal, ready)
				.then((raw) => {
					scanning = false;
					useText(raw);
				})
				.catch((e) => {
					scanning = false;
					ready();
					if ((e as DOMException).name !== 'AbortError')
						camError = `Sin cámara (${e instanceof Error ? e.message : e}): cambia a sonido o a copiar y pegar.`;
				});
		});
	}

	// ---------- Iniciar: emito la oferta, recibo la respuesta ----------
	async function start(m: Method) {
		reset();
		role = 'init';
		method = m;
		mode = 'offering';
		startClock();
		try {
			// Permiso de captura ANTES de la oferta: con él, el navegador expone la IP local real en lugar del nombre
			// mDNS «.local» (que en algunas redes no se resuelve). Sonido → micrófono; QR → cámara (para leer la respuesta).
			// QR + sonido → micrófono (la respuesta llega por sonido).
			if (m === 'sound' || m === 'qrsound') await startListen('a', (t) => void gotAnswer(t));
			if (m === 'qr') await startScan();
			offer = await createOffer();
			myText = offer.signal;
			if (m === 'qr' || m === 'qrsound')
				qr = qrSvg(`${location.origin}${base}${linkPath}#s=${encodeURIComponent(offer.signal)}${m === 'qrsound' ? '&m=qs' : ''}`);
			if (m === 'sound') {
				const em = await makeEmitter(offer.signal);
				if (em) void offerCycle(em);
			}
		} catch (e) {
			err(e);
		}
	}

	let finishing = false;
	async function gotAnswer(text: string) {
		if (!offer || finishing) return;
		finishing = true;
		mode = 'connecting';
		stopCapture();
		try {
			const { channel, theirs } = await connectAnswer(offer, text);
			const code = await codeFor(offer.mine, theirs);
			mode = 'connected';
			if (timer) clearInterval(timer);
			// La conexión pasa a quien la pidió: que la limpieza de este componente (al desmontarse) no la cierre.
			const link = offer;
			offer = null;
			onconnected({ channel, pc: link.pc, initiator: true, code, binding: bindingFor(link.mine, theirs) });
		} catch (e) {
			finishing = false;
			mode = 'offering';
			err(e);
			if (method === 'qr') void startScan();
			if (method === 'qrsound') void startListen('a', (t) => void gotAnswer(t));
		}
	}

	// ---------- Unirme: recibo la oferta, emito la respuesta ----------
	async function join(m: Method) {
		reset();
		role = 'join';
		method = m;
		mode = 'joining';
		startClock();
		if (m === 'sound') await startListen('o', onOfferHeard);
		if (m === 'qr' || m === 'qrsound') await startScan();
	}

	/** Cada vez que se oye la oferta (= el iniciador acaba de terminar de emitir). */
	function onOfferHeard(t: string) {
		if (mode === 'joining') void gotOffer(t);
		else if (mode === 'answering') answerNow();
	}

	async function gotOffer(text: string) {
		if (mode !== 'joining' && mode !== 'idle') return;
		mode = 'answering';
		scanAbort?.abort();
		try {
			const ans = await acceptOffer(text);
			myText = ans.signal;
			// La respuesta la escanea la cámara de la página del otro: basta el texto, sin enlace.
			if (method === 'qr') qr = qrSvg(ans.signal);
			if (method === 'sound' && (await makeEmitter(ans.signal))) answerNow(); // la oferta acaba de terminar: el otro calla ahora
			if (method === 'qrsound') {
				const em = await makeEmitter(ans.signal);
				// Abierto desde la cámara del sistema (sin toque previo): el navegador no deja sonar hasta que se toque la pantalla.
				needsTap = audioContext().state === 'suspended';
				if (em) void answerLoop(em);
			}
			const channel = await ans.channel();
			stopCapture();
			const code = await codeFor(ans.mine, ans.theirs);
			mode = 'connected';
			if (timer) clearInterval(timer);
			onconnected({ channel, pc: ans.pc, initiator: false, code, binding: bindingFor(ans.mine, ans.theirs) });
		} catch (e) {
			stopCapture();
			mode = 'joining';
			err(e);
			if (method === 'sound') void startListen('o', onOfferHeard);
			if (method === 'qr' || method === 'qrsound') void startScan();
		}
	}

	// ---------- Texto leído (QR) o pegado ----------
	function useText(raw: string) {
		const text = decodeURIComponent(raw.trim().replace(/^.*#s=/, ''));
		try {
			const s = decode(text);
			if (s.role === 'o') {
				if (role === 'init') throw new Error('Ese es un código de inicio: en el otro dispositivo pulsa «Unirme».');
				void gotOffer(text);
			} else {
				if (role === 'join') throw new Error('Ese código es una respuesta: en este dispositivo pulsa «Iniciar».');
				void gotAnswer(text);
			}
		} catch (e) {
			err(e);
			if ((method === 'qr' || (method === 'qrsound' && role === 'join')) && !scanning && (mode === 'joining' || mode === 'offering'))
				void startScan();
		}
	}

	function setProtocol(p: ProtocolKey) {
		protocol = p;
		emitter?.setProtocol(p);
	}

	async function copy() {
		await navigator.clipboard.writeText(myText).then(
			() => (copied = true),
			() => {}
		);
	}

	/** Mismo papel, otro método: vuelve a empezar (oferta nueva). */
	function switchTo(m: Method) {
		if (role === 'init') void start(m);
		else void join(m);
	}

	function choose(r: 'init' | 'join') {
		reset();
		role = r;
		mode = 'choose';
	}

	// Abierto desde el QR con la cámara del sistema: ya tengo la oferta; respondo por sonido o con mi QR, según el otro.
	// Efecto (no onMount): la página puede pasar la oferta después de montar este componente.
	$effect(() => {
		const text = offerFromLink; // solo depende de la oferta (no de `mode`: «Cancelar» no debe re-aceptarla)
		untrack(() => {
			if (!text || mode !== 'idle') return;
			role = 'join';
			method = linkMethod;
			void gotOffer(text);
		});
	});
	onDestroy(reset);

	const pct = (db: number) => Math.max(0, Math.min(100, ((db + 120) / 90) * 100));
	const other = $derived(METHODS.filter((m) => m.key !== method));
	const active = $derived(mode === 'offering' || mode === 'joining' || mode === 'answering');
</script>

<div class="pairing stack">

	{#if mode === 'idle'}
		<div class="two">
			<button class="primary big" onclick={() => choose('init')}>
				<strong>Iniciar</strong><span class="small">este dispositivo genera el código</span>
			</button>
			<button class="big" onclick={() => choose('join')}>
				<strong>Unirme</strong><span class="small">recibo el código del otro</span>
			</button>
		</div>
		<p class="small dim">
			Pulsa «Iniciar» en uno y «Unirme» en el otro. Los datos viajan por tu red local: no hace falta internet, solo estar en la misma
			WiFi.
		</p>
	{:else if mode === 'choose'}
		<h3>¿Cómo os emparejáis? <span class="dim small">({role === 'init' ? 'inicio' : 'me uno'})</span></h3>
		<div class="methods">
			{#each METHODS as m (m.key)}
				<button class="big" class:primary={m.key === RECOMMENDED} onclick={() => (role === 'init' ? start(m.key) : join(m.key))}>
					<strong>{m.icon} {m.label}{#if m.key === RECOMMENDED} <span class="small">· recomendado</span>{/if}</strong>
					<span class="small">{m.hint}</span>
				</button>
			{/each}
		</div>
		<p class="small dim">Elegid el mismo método en los dos dispositivos.</p>
		<div><button class="ghost small" onclick={reset}>Volver</button></div>
	{:else if mode === 'connecting'}
		<p><span class="spinner"></span> Conectando por la red local…</p>
	{:else if mode === 'connected'}
		<p class="ok-text">✓ Conectados por la red local.</p>
	{:else}
		<p class="small muted">
			{METHODS.find((m) => m.key === method)?.icon}
			<strong>{METHODS.find((m) => m.key === method)?.label}</strong> · {role === 'init' ? 'inicio' : 'me uno'} · {elapsed} s
		</p>

		<!-- ===== Sonido ===== -->
		{#if method === 'sound'}
			{#if mode === 'joining'}
				<p class="small">{#if listener}🎙 Escuchando el código del otro…{:else}Esperando el micrófono…{/if}</p>
				<p class="small dim">En el otro: «Iniciar» → «Sonido». Mantén los dispositivos cerca (menos de 1 m).</p>
			{:else if myText}
				<p class="small">
					{#if !emitter}Sin sonido
					{:else if phase === 'emit'}<strong>🔊 Emitiendo{mode === 'answering' ? ' mi respuesta' : ' mi código'}…</strong>
					{:else if mode === 'offering'}<strong>🤫 En silencio: escuchando la respuesta</strong> (vuelvo a emitir en unos segundos)
					{:else}Respondo cada vez que el otro termina de emitir{/if}
					{#if heard}· recibida{/if}
				</p>
				<p class="small dim">
					{#if mode === 'offering'}En el otro: «Unirme» → «Sonido». Se turnan: uno emite mientras el otro calla.{:else}Mantén los dispositivos cerca (menos de 1 m).{/if}
				</p>
				<div class="row small">
					<label class="inline"
						>Modo
						<select value={protocol} onchange={(e) => setProtocol((e.target as HTMLSelectElement).value as ProtocolKey)}>
							<option value="ultra_normal">Ultrasonido · lento</option>
							<option value="ultra_fast">Ultrasonido</option>
							<option value="ultra_fastest">Ultrasonido · máximo</option>
							<option value="audible_fast">Audible (más robusto)</option>
						</select>
					</label>
					<a href="/lab/ultrasonido" target="_blank">¿Se oye o molesta? Ajustar sonido</a>
				</div>
			{/if}
			{#if listener && mode !== 'answering'}
				<div class="meter" role="meter" aria-label="Energía ultrasónica" aria-valuemin="-120" aria-valuemax="-30" aria-valuenow={Math.round(level)}>
					<div style="width:{pct(level)}%"></div>
				</div>
				{#if mode === 'offering'}
					<p class="small dim">Mientras emito, la barra sube por mi propio sonido. En el silencio, debería subir cuando el otro responda.</p>
				{/if}
			{/if}
			{#if micError}<p class="small warn-text">{micError}</p>{/if}
			{#if elapsed > 25 && !heard && listener}
				<p class="small dim">¿No llega? Acerca los dispositivos, prueba el modo «Ultrasonido · máximo» o «Audible», o cambia de método.</p>
			{/if}
		{/if}

		<!-- ===== QR ===== -->
		{#if method === 'qr'}
			{#if qr}
				<div class="qr-row">
					<div class="qr" aria-label="Código QR">{@html qr}</div>
					<p class="small">
						{#if mode === 'offering'}
							En el otro: «Unirme» → «QR» y escanea este código (o ábrelo con la cámara del sistema). Luego enseña su QR a
							<strong>esta</strong> cámara.
						{:else}
							Enséñale este QR a la cámara del otro dispositivo.
						{/if}
					</p>
				</div>
			{/if}
			{#if mode !== 'answering'}
				<p class="small">
					{#if scanning}📷 Apunta la cámara al QR {mode === 'offering' ? 'de la respuesta' : 'del otro'}…{:else if !camError}Abriendo la
						cámara…{/if}
				</p>
			{/if}
			{#if camError}<p class="small warn-text">{camError}</p>{/if}
		{/if}

		<!-- ===== QR + sonido: el que inicia muestra el QR y escucha; el otro escanea y responde por sonido ===== -->
		{#if method === 'qrsound'}
			{#if mode === 'offering'}
				{#if qr}
					<div class="qr-row">
						<div class="qr" aria-label="Código QR">{@html qr}</div>
						<p class="small">
							En el móvil: «Unirme» → «QR + sonido» y escanea este código (o ábrelo con la cámara del sistema). Responderá por sonido:
							mantenlo cerca.
						</p>
					</div>
				{/if}
				<p class="small">
					{#if listener}🎙 Escuchando la respuesta…{:else if !micError}Esperando el micrófono…{/if}
					{#if heard}· recibida{/if}
				</p>
				{#if listener}
					<div class="meter" role="meter" aria-label="Energía ultrasónica" aria-valuemin="-120" aria-valuemax="-30" aria-valuenow={Math.round(level)}>
						<div style="width:{pct(level)}%"></div>
					</div>
				{/if}
				{#if micError}<p class="small warn-text">{micError}</p>{/if}
				{#if elapsed > 40 && !heard && listener}
					<p class="small dim">¿No llega? Acerca el móvil al micrófono del PC o, en el móvil, cambia el modo a «Audible».</p>
				{/if}
			{:else if mode === 'joining'}
				<p class="small">
					{#if scanning}📷 Apunta la cámara al QR del otro…{:else if !camError}Abriendo la cámara…{/if}
				</p>
				{#if camError}<p class="small warn-text">{camError}</p>{/if}
			{:else}
				{#if needsTap}
					<button class="primary big" onclick={() => void audioContext().resume().then(() => (needsTap = false))}>
						<strong>🔊 Tocar para responder por sonido</strong><span class="small">el navegador necesita un toque para sonar</span>
					</button>
				{:else}
					<p class="small">
						{#if !emitter}Sin sonido{:else if phase === 'emit'}<strong>🔊 Respondiendo por sonido…</strong>{:else}Repito la respuesta en
							un momento…{/if}
					</p>
				{/if}
				<div class="row small">
					<label class="inline"
						>Modo
						<select value={protocol} onchange={(e) => setProtocol((e.target as HTMLSelectElement).value as ProtocolKey)}>
							<option value="ultra_normal">Ultrasonido · lento</option>
							<option value="ultra_fast">Ultrasonido</option>
							<option value="ultra_fastest">Ultrasonido · máximo</option>
							<option value="audible_fast">Audible (más robusto)</option>
						</select>
					</label>
				</div>
				{#if micError}<p class="small warn-text">{micError}</p>{/if}
			{/if}
		{/if}

		<!-- ===== Copiar y pegar ===== -->
		{#if method === 'paste'}
			{#if myText}
				<p class="small">
					{mode === 'offering' ? '1. Pasa este código al otro dispositivo (chat, nota…):' : '2. Pasa esta respuesta al otro dispositivo:'}
				</p>
				<code class="code">{myText}</code>
				<div><button class="small" onclick={copy}>{copied ? '✓ Copiado' : 'Copiar'}</button></div>
			{/if}
			{#if mode !== 'answering'}
				<div class="row">
					<input
						class="grow"
						bind:value={pasted}
						placeholder={mode === 'offering' ? '2. Pega aquí la respuesta del otro (S2~a~…)' : 'Pega aquí el código del otro (S2~o~…)'}
						aria-label="Código del otro dispositivo"
					/>
					<button class="small" onclick={() => useText(pasted)} disabled={!pasted.trim()}>Usar</button>
				</div>
			{/if}
			<p class="small dim">
				En el otro: «{role === 'init' ? 'Unirme' : 'Iniciar'}» → «Copiar y pegar». Sin permisos, el navegador oculta la IP local y en
				algunas redes no conecta: si pasa, usa sonido o QR.
			</p>
		{/if}

		{#if mode === 'answering'}<p class="small muted"><span class="spinner"></span> Esperando que el otro conecte…</p>{/if}

		<!-- svelte-ignore a11y_media_has_caption -->
		<video bind:this={video} class:hidden={!((method === 'qr' || method === 'qrsound') && scanning)} playsinline muted></video>

		{#if active}
			<div class="row small">
				<span class="dim">Cambiar a:</span>
				{#each other as m (m.key)}<button class="ghost small" onclick={() => switchTo(m.key)}>{m.icon} {m.label}</button>{/each}
				<button class="ghost small" onclick={reset}>Cancelar</button>
			</div>
		{/if}
	{/if}
</div>

<style>
	.two {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
		gap: 0.8rem;
	}
	.methods {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
		gap: 0.6rem;
	}
	h3 {
		margin: 0;
	}
	.big {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 0.2rem;
		padding: 0.9rem 1rem;
		text-align: left;
	}
	.qr-row {
		display: flex;
		gap: 1rem;
		align-items: flex-start;
		flex-wrap: wrap;
	}
	.qr-row p {
		flex: 1;
		min-width: 200px;
		margin: 0;
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
	.code {
		display: block;
		word-break: break-all;
		font-size: 0.8rem;
		padding: 0.5rem 0.6rem;
		background: var(--bg-3);
		border-radius: var(--radius-sm);
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
