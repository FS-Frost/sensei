<script lang="ts">
	// Ajustes → App: instalar, recordatorio de repasos y qué funciones de app tiene este navegador.
	import { onMount } from 'svelte';
	import { install, isIos, promptInstall } from '../client/install.svelte.ts';
	import { toast } from '../client/toast.svelte.ts';
	import { disableReminder, enableReminder, reminderEnabled, reminderSupport, testNotification, type ReminderSupport } from '../client/reminder.ts';

	let on = $state(false);
	let busy = $state(false);
	let support = $state<ReminderSupport>({ notifications: false, periodic: false, badge: false });
	let ios = $state(false);
	let denied = $state(false);

	onMount(() => {
		support = reminderSupport();
		ios = isIos();
		on = reminderEnabled() && typeof Notification !== 'undefined' && Notification.permission === 'granted';
		denied = typeof Notification !== 'undefined' && Notification.permission === 'denied';
	});

	let testing = $state(false);
	async function test() {
		testing = true;
		try {
			const r = await testNotification();
			if (r.ok) toast.success('Notificación de prueba enviada', { detail: r.message, duration: 8000 });
			else toast.warn('No se pudo probar', { detail: r.message });
			denied = typeof Notification !== 'undefined' && Notification.permission === 'denied';
		} finally {
			testing = false;
		}
	}

	async function toggle() {
		busy = true;
		try {
			if (on) {
				await disableReminder();
				on = false;
				toast.info('Recordatorio desactivado');
			} else {
				const r = await enableReminder();
				on = r.ok;
				if (r.ok) toast.success('Recordatorio activado', { detail: r.message, duration: 7000 });
				else toast.warn('No se pudo activar el recordatorio', { detail: r.message });
				denied = typeof Notification !== 'undefined' && Notification.permission === 'denied';
			}
		} finally {
			busy = false;
		}
	}
</script>

<div class="card stack" id="app">
	<h2>App</h2>

	{#if install.installed}
		<p class="small ok-text">✓ Abierta como app instalada.</p>
	{:else if install.available}
		<p class="small muted">Instálala para abrirla como una app (icono propio, sin barra del navegador) y recibir lo que compartas.</p>
		<div><button class="primary small" onclick={() => promptInstall()}>Instalar Sensei</button></div>
	{:else if ios}
		<p class="small muted">
			Para instalarla en iPhone/iPad: en Safari, botón <strong>Compartir</strong> → <strong>Añadir a pantalla de inicio</strong>.
		</p>
	{:else}
		<p class="small muted">
			Para instalarla: menú del navegador → <strong>Instalar Sensei</strong> (o «Añadir a pantalla de inicio»). Si no aparece, ya está
			instalada en este dispositivo (ábrela desde su icono), o este navegador no lo permite (Firefox de escritorio).
		</p>
	{/if}

	<h3>Recordatorio de repasos</h3>
	<p class="small muted">
		Como mucho un aviso al día (entre las 8 y las 22 h) si tienes repasos pendientes
		{#if support.badge}, y el número de pendientes en el icono de la app{/if}. Sin servidor: el navegador despierta a Sensei unas pocas
		veces al día por su cuenta, así que el aviso puede llegar a cualquier hora de ese rango.
	</p>
	{#if !support.notifications}
		<p class="small warn-text">Este navegador no muestra notificaciones.</p>
	{:else}
		<div class="row">
			<label class="check small">
				<input type="checkbox" checked={on} disabled={busy || (denied && !on)} onchange={toggle} />
				Avisarme si tengo repasos pendientes
			</label>
			<button class="small" onclick={test} disabled={testing || denied} title="Muestra una notificación ahora para comprobar que llegan">
				{#if testing}<span class="spinner"></span>{/if} 🔔 Probar notificación
			</button>
		</div>
		{#if denied && !on}<p class="small warn-text">Notificaciones bloqueadas para este sitio: permítelas en los ajustes del navegador.</p>{/if}
		{#if !support.periodic}
			<p class="small dim">
				Este navegador no despierta apps en segundo plano (solo Chrome/Edge con la app instalada, sobre todo en Android): sin aviso,
				pero verás los pendientes al abrirla.
			</p>
		{/if}
	{/if}

	<h3>Desde otras apps</h3>
	<ul class="small muted">
		<li><strong>Compartir → Sensei</strong>: un texto japonés o una foto van al Explicador; un .txt / .srt / .epub, a la Biblioteca.</li>
		<li>En el PC, <strong>abrir con Sensei</strong> archivos .txt, .srt, .epub o una copia .zip.</li>
		<li>Mantén pulsado el icono para ir directo a Repaso, Lección, Explicador o Sincronizar.</li>
	</ul>
	<p class="small dim">Necesitan la app instalada en Chrome o Edge (Android, Windows, Mac, Linux). En iPhone/iPad no están disponibles.</p>
</div>

<style>
	h3 {
		margin: 0.4rem 0 0;
		font-size: 1rem;
	}
	ul {
		margin: 0;
		padding-left: 1.2rem;
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
	.ok-text {
		color: var(--ok);
	}
	.warn-text {
		color: var(--warn);
	}
</style>
