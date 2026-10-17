<script lang="ts">
	// Laboratorio: ¿se conectan dos dispositivos directamente por la red local (sin internet)? Empareja por sonido o QR
	// y envía un bloque de prueba para medir la velocidad. No toca tus datos ni necesita el diccionario.
	import Pairing from '#lib/components/sync/Pairing.svelte';
	import { channelTransport, type Connected } from '#lib/client/sync/rtc.ts';
	import type { Transport } from '#lib/client/sync/protocol.ts';

	let conn: Connected | null = $state(null);
	let t: Transport | null = null;
	let log: string[] = $state([]);
	let sizeMb = $state(5);
	let busy = $state(false);
	let attempt = $state(0);
	let route = $state('');
	let pairedAt = 0;
	const opened = Date.now();
	// Oferta que llega por el enlace del QR (un solo uso: se quita de la barra de direcciones).
	let offerFromLink = $state<string | null>(
		(() => {
			const m = typeof location !== 'undefined' ? location.hash.match(/[#&]s=([^&]+)/) : null;
			if (!m) return null;
			history.replaceState(null, '', location.pathname);
			return decodeURIComponent(m[1]);
		})()
	);

	const add = (s: string) => (log = [...log, `${new Date().toLocaleTimeString('es')} · ${s}`]);

	async function describeRoute(pc: RTCPeerConnection) {
		const stats = await pc.getStats();
		let pair: RTCIceCandidatePairStats | undefined;
		stats.forEach((r) => {
			if (r.type === 'candidate-pair' && (r as RTCIceCandidatePairStats).nominated && (r as RTCIceCandidatePairStats).state === 'succeeded') pair = r as RTCIceCandidatePairStats;
		});
		if (!pair) return 'desconocida';
		const loc = stats.get(pair.localCandidateId) as { address?: string; candidateType?: string } | undefined;
		const rem = stats.get(pair.remoteCandidateId) as { address?: string; candidateType?: string } | undefined;
		return `${loc?.address ?? '?'} (${loc?.candidateType}) ↔ ${rem?.address ?? '?'} (${rem?.candidateType})`;
	}

	let incoming: { size: number; got: number; t0: number } | null = null;

	async function connected(c: Connected) {
		conn = c;
		pairedAt = Date.now();
		add(`Conectados por la red local en ${((pairedAt - opened) / 1000).toFixed(1)} s desde que abriste la página · código ${c.code}`);
		route = await describeRoute(c.pc);
		add(`Ruta: ${route}`);
		t = channelTransport(c.channel);
		t.onmessage = (d) => {
			if (typeof d === 'string') {
				const m = JSON.parse(d);
				if (m.type === 'start') {
					incoming = { size: m.size, got: 0, t0: performance.now() };
					add(`Recibiendo ${(m.size / 1048576).toFixed(1)} MB…`);
				} else if (m.type === 'end' && incoming) {
					const s = (performance.now() - incoming.t0) / 1000;
					const ok = incoming.got === incoming.size;
					add(`${ok ? '✓' : '✗'} Recibido ${(incoming.got / 1048576).toFixed(1)} MB en ${s.toFixed(2)} s (${(incoming.got / 1048576 / s).toFixed(1)} MB/s)`);
					void t!.send(JSON.stringify({ type: 'ack', ms: s * 1000, got: incoming.got }));
					incoming = null;
				} else if (m.type === 'ack') {
					add(`✓ El otro recibió ${(m.got / 1048576).toFixed(1)} MB en ${(m.ms / 1000).toFixed(2)} s (${(m.got / 1048576 / (m.ms / 1000)).toFixed(1)} MB/s)`);
					busy = false;
				}
			} else if (incoming) incoming.got += d.byteLength;
		};
	}

	async function sendTest() {
		if (!t) return;
		busy = true;
		const size = Math.round(sizeMb * 1048576);
		const chunk = new Uint8Array(64 * 1024);
		crypto.getRandomValues(chunk);
		add(`Enviando ${sizeMb} MB…`);
		await t.send(JSON.stringify({ type: 'start', size }));
		for (let sent = 0; sent < size; sent += chunk.length) await t.send(chunk.slice(0, Math.min(chunk.length, size - sent)).buffer);
		await t.send(JSON.stringify({ type: 'end' }));
	}

	function again() {
		conn?.pc.close();
		conn = null;
		t = null;
		log = [];
		offerFromLink = null;
		attempt++;
	}
</script>

<svelte:head><title>Laboratorio: red local · Sensei</title></svelte:head>

<div class="lab">
	<a href="/" class="small">← Sensei</a>
	<h1>Laboratorio: conexión por red local</h1>
	<p class="muted small">
		Comprueba que dos dispositivos se conectan <strong>directamente por tu WiFi</strong> (sin internet): se emparejan por sonido o QR
		y se envía un bloque de prueba. Para probar sin internet, desconecta el router de internet (o usa el móvil como punto de acceso
		y conecta el PC a él). Tus datos no se tocan.
	</p>

	<section class="card stack">
		{#if !conn}
			{#key attempt}<Pairing onconnected={connected} linkPath="/lab/red-local" {offerFromLink} />{/key}
		{:else}
			<p>✓ Conectados · código <strong>{conn.code}</strong> (debe ser el mismo en ambos)</p>
			<div class="row">
				<label class="inline small">MB <input type="number" min="1" max="200" bind:value={sizeMb} /></label>
				<button class="primary" onclick={sendTest} disabled={busy}>Enviar bloque de prueba</button>
				<button class="ghost" onclick={again}>Volver a emparejar</button>
			</div>
		{/if}
		{#if log.length}
			<ol class="log small">
				{#each log as l, i (i)}<li>{l}</li>{/each}
			</ol>
		{/if}
	</section>

	<section class="card small stack">
		<h2>Qué anotar</h2>
		<ul>
			<li>Si conecta, cuánto tarda el emparejamiento (sonido, QR o pegado) y la velocidad del bloque de prueba.</li>
			<li>La «ruta»: direcciones locales (`host`) confirman que no pasó por internet.</li>
			<li>Si falla: tipo de red (casa, invitados, punto de acceso del móvil) y dispositivos.</li>
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
	.inline {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		margin: 0;
	}
	.inline input {
		width: 5rem;
	}
	.log {
		margin: 0;
		padding-left: 1.4rem;
		font-family: ui-monospace, monospace;
	}
	ul {
		margin: 0;
		padding-left: 1.2rem;
	}
</style>
