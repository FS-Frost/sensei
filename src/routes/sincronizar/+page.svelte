<script lang="ts">
	// Sincronizar con otro dispositivo: emparejar por sonido (o QR) y pasar los datos por la red local.
	import { onMount } from 'svelte';
	import { refreshAll } from '$app/navigation';
	import { del, get, errMsg } from '#lib/client/api.ts';
	import HelpLink from '#lib/components/HelpLink.svelte';
	import Pairing from '#lib/components/sync/Pairing.svelte';
	import { channelTransport, deviceName, type Connected } from '#lib/client/sync/rtc.ts';
	import { SyncSession, type Status, type Summary } from '#lib/client/sync/protocol.ts';
	import { syncApi } from '#lib/client/sync/api.ts';
	import { DEFAULT_PROFILE, describeProfile, loadProfile } from '#lib/client/sound.ts';

	// Sonido de este dispositivo (se ajusta y calibra en /lab/ultrasonido; se relee al volver a esta pestaña).
	let sound = $state(loadProfile());
	const soundIsDefault = $derived(JSON.stringify(sound) === JSON.stringify(DEFAULT_PROFILE));

	type Peer = { id: string; name: string; lastHash: string | null; lastAt: number | null };

	let peers: Peer[] = $state([]);
	let status: Status | null = $state(null);
	let session: SyncSession | null = null;
	let conn: Connected | null = null;
	let remember = $state(true);
	let attempt = $state(0);
	let offerFromLink: string | null = $state(null);
	let error = $state('');
	let renaming: string | null = $state(null);
	let renameValue = $state('');
	const myName = deviceName();

	async function loadPeers() {
		peers = (await get<{ peers: Peer[] }>('/api/sync/peers')).peers;
	}

	function connected(c: Connected) {
		conn = c;
		session = new SyncSession({
			transport: channelTransport(c.channel),
			api: syncApi,
			initiator: c.initiator,
			name: myName,
			code: c.code,
			binding: c.binding,
			remember,
			onStatus: (s) => (status = s)
		});
		void session.start();
		void session.done.then(async (s) => {
			if (s.step === 'done' && s.result === 'received') await refreshAll();
			await loadPeers();
			setTimeout(() => conn?.pc.close(), 1500);
		});
	}

	function again() {
		conn?.pc.close();
		conn = null;
		session = null;
		status = null;
		offerFromLink = null;
		attempt++;
	}

	async function forget(p: Peer) {
		await del(`/api/sync/peers/${encodeURIComponent(p.id)}`);
		await loadPeers();
	}

	async function rename(p: Peer) {
		const name = renameValue.trim();
		renaming = null;
		if (!name || name === p.name) return;
		await fetch(`/api/sync/peers/${encodeURIComponent(p.id)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) });
		await loadPeers();
	}

	const when = (t: number | null) => (t ? new Date(t).toLocaleString('es', { dateStyle: 'medium', timeStyle: 'short' }) : '—');
	const summary = (x: Summary) => `${x.counts.reviews ?? 0} repasos · ${x.counts.cards ?? 0} tarjetas · ${x.counts.sessions ?? 0} sesiones del tutor`;
	const kb = (n: number) => (n < 1048576 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1048576).toFixed(1)} MB`);

	onMount(() => {
		const m = location.hash.match(/[#&]s=([^&]+)/);
		if (m) {
			offerFromLink = decodeURIComponent(m[1]);
			history.replaceState(null, '', location.pathname); // un solo uso: no reutilizar al recargar
		}
		loadPeers().catch((e) => (error = errMsg(e)));
	});
</script>

<svelte:window onfocus={() => (sound = loadProfile())} />

<svelte:head><title>Sincronizar · Sensei</title></svelte:head>

<h1>Sincronizar <HelpLink section="sincronizar" /></h1>
<p class="muted small">
	Pasa tu progreso entre este dispositivo y otro (PC ↔ móvil) <strong>sin internet</strong>: se emparejan por sonido y los datos
	viajan por tu red local. Eliges cómo emparejarlos: sonido, QR o copiar y pegar. Este dispositivo: <strong>{myName}</strong>.
</p>
{#if error}<div class="error small">{error}</div>{/if}

<section class="card stack">
	{#if !status}
		{#key attempt}
			<Pairing onconnected={connected} {offerFromLink} />
		{/key}
		<label class="check small"><input type="checkbox" bind:checked={remember} /> Recordar el otro dispositivo (la próxima vez no pedirá código)</label>
	{:else if status.step === 'handshake'}
		<p><span class="spinner"></span> Conectados. Comparando datos…</p>
	{:else if status.step === 'confirm'}
		<h2>¿Es tu dispositivo?</h2>
		<p>Comprueba que <strong>{status.peerName}</strong> muestra el mismo código:</p>
		<div class="code-big">{status.code.split('').join(' ')}</div>
		{#if status.waitingOther}
			<p class="small muted"><span class="spinner"></span> Esperando que confirmes también en {status.peerName}…</p>
		{:else}
			<div class="row">
				<button class="primary" onclick={() => session?.confirm(true)}>Sí, coincide</button>
				<button class="ghost" onclick={() => session?.confirm(false)}>No coincide</button>
			</div>
		{/if}
	{:else if status.step === 'ask'}
		<h2>Los dos tienen cambios</h2>
		<p class="small muted">No se mezclan: elige con qué datos quedarse. Los descartados quedan en una copia («Antes de sincronizar») en Datos.</p>
		<div class="choices">
			<div class="choice card">
				<strong>Este dispositivo · {status.mine.name}</strong>
				<span class="small">{summary(status.mine)}</span>
				<span class="small dim">Último cambio: {when(status.mine.updatedAt)}</span>
				<button class="primary" disabled={status.waitingOther} onclick={() => session?.choose('mine')}>Quedarme con estos</button>
			</div>
			<div class="choice card">
				<strong>{status.theirs.name}</strong>
				<span class="small">{summary(status.theirs)}</span>
				<span class="small dim">Último cambio: {when(status.theirs.updatedAt)}</span>
				<button class="primary" disabled={status.waitingOther} onclick={() => session?.choose('theirs')}>Quedarme con estos</button>
			</div>
		</div>
		{#if status.waitingOther}<p class="small muted"><span class="spinner"></span> Esperando al otro dispositivo…</p>{/if}
	{:else if status.step === 'transfer'}
		<p>{status.direction === 'send' ? 'Enviando tus datos…' : 'Recibiendo datos…'} {status.total ? `${kb(status.done)} de ${kb(status.total)}` : ''}</p>
		<div class="bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow={status.total ? Math.round((status.done / status.total) * 100) : 0}>
			<div style="width:{status.total ? (status.done / status.total) * 100 : 5}%"></div>
		</div>
	{:else if status.step === 'done'}
		<h2>✓ Listo</h2>
		<p>
			{#if status.result === 'same'}Ya estaban sincronizados con {status.peerName}.
			{:else if status.result === 'sent'}{status.peerName} recibió tus datos.
			{:else}Recibido de {status.peerName}: {status.counts.cards ?? 0} tarjetas, {status.counts.reviews ?? 0} repasos.{/if}
		</p>
		{#if status.remembered}<p class="small muted">{status.peerName} queda recordado: la próxima vez no hará falta el código.</p>{/if}
		{#if status.result === 'received'}<p class="small dim">Tu estado anterior quedó en Datos → Copias («Antes de sincronizar»).</p>{/if}
		<div><button onclick={again}>Sincronizar otra vez</button></div>
	{:else if status.step === 'error'}
		<div class="error small">{status.message}</div>
		<div><button onclick={again}>Volver a empezar</button></div>
	{/if}
</section>

<section class="card stack">
	<h2>Sonido de este dispositivo</h2>
	<p class="small">{describeProfile(sound)}{#if soundIsDefault} <span class="dim">(por defecto)</span>{/if}</p>
	<p class="small muted">
		¿Se oye o molesta? ¿No llega al otro? Ajusta volumen, filtro y rampa, compáralos y calibra el volumen mínimo entre tus dos
		dispositivos. Cada uno guarda el suyo.
	</p>
	<div><a class="btn" href="/lab/ultrasonido">🔊 Ajustar y calibrar el sonido</a></div>
</section>

{#if peers.length}
	<section class="card stack">
		<h2>Dispositivos recordados</h2>
		<p class="small muted">Se reconocen sin código. Igualmente hay que emparejarlos (sonido o QR) cada vez: así funciona sin internet.</p>
		<table class="small">
			<tbody>
				{#each peers as p (p.id)}
					<tr>
						<td>
							{#if renaming === p.id}
								<!-- svelte-ignore a11y_autofocus -->
								<input bind:value={renameValue} autofocus onblur={() => rename(p)} onkeydown={(e) => e.key === 'Enter' && rename(p)} />
							{:else}{p.name}{/if}
						</td>
						<td class="dim">Última vez: {when(p.lastAt)}</td>
						<td class="acts">
							<button
								class="ghost small"
								onclick={() => {
									renaming = p.id;
									renameValue = p.name;
								}}>Renombrar</button
							>
							<button class="ghost small" onclick={() => forget(p)}>Olvidar</button>
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</section>
{/if}

<section class="card small stack">
	<h2>Si no funciona</h2>
	<ul>
		<li><strong>Misma red:</strong> ambos en la misma WiFi. Algunas redes de invitados aíslan los dispositivos; en ese caso, usa el móvil como punto de acceso y conecta el PC a él (no hace falta que tenga datos).</li>
		<li><strong>Sonido:</strong> acerca los dispositivos y cambia a «Audible» si el ultrasonido no llega. Ajusta y calibra el sonido en el <a href="/lab/ultrasonido">laboratorio de ultrasonido</a>.</li>
		<li><strong>Sin sonido:</strong> elige «QR» (cada uno escanea el del otro) o «Copiar y pegar» (pasa el código por un chat o una nota). Durante el emparejamiento, «Cambiar a:» salta a otro método.</li>
		<li><strong>Red local:</strong> prueba la conexión directa entre tus dispositivos en el <a href="/lab/red-local">laboratorio de red local</a>.</li>
	</ul>
</section>

<style>
	.code-big {
		font-size: 2.4rem;
		font-weight: 700;
		letter-spacing: 0.2em;
		font-variant-numeric: tabular-nums;
	}
	.choices {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
		gap: 0.8rem;
	}
	.choice {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
	}
	.bar {
		height: 8px;
		border-radius: 999px;
		background: var(--bg-3);
		overflow: hidden;
	}
	.bar div {
		height: 100%;
		background: var(--series-1);
	}
	.check {
		display: flex;
		gap: 0.5rem;
		align-items: center;
		margin: 0;
	}
	.check input {
		width: auto;
	}
	table {
		border-collapse: collapse;
		width: 100%;
	}
	td {
		padding: 0.35rem 0.4rem;
		border-bottom: 1px solid var(--line);
	}
	.acts {
		text-align: right;
		white-space: nowrap;
	}
	ul {
		margin: 0;
		padding-left: 1.2rem;
	}
</style>
