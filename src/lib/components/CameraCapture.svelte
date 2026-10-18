<script lang="ts">
	// Hacer una foto con la cámara dentro de la app (getUserMedia): para PC y tablets. En el móvil se usa la cámara
	// nativa (input con capture="environment", ver PhotoButtons). Prefiere la cámara trasera y deja cambiar de cámara.
	import { onDestroy } from 'svelte';

	let { open = $bindable(false), oncapture }: { open?: boolean; oncapture: (file: File) => void } = $props();

	let dialog: HTMLDialogElement | undefined = $state();
	let video: HTMLVideoElement | undefined = $state();
	let stream: MediaStream | null = null;
	let devices: MediaDeviceInfo[] = $state([]);
	let deviceId: string | null = $state(null);
	let error = $state('');
	let starting = $state(false);

	function stop() {
		stream?.getTracks().forEach((t) => t.stop());
		stream = null;
	}

	async function start() {
		stop();
		error = '';
		starting = true;
		try {
			stream = await navigator.mediaDevices.getUserMedia({
				audio: false,
				video: deviceId
					? { deviceId: { exact: deviceId }, width: { ideal: 1920 }, height: { ideal: 1080 } }
					: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }
			});
			if (video) {
				video.srcObject = stream;
				await video.play().catch(() => {});
			}
			// Con permiso ya se ven los nombres de las cámaras (para poder cambiar).
			devices = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput');
			deviceId ??= stream.getVideoTracks()[0]?.getSettings().deviceId ?? null;
		} catch (e) {
			const name = e instanceof DOMException ? e.name : '';
			error =
				name === 'NotAllowedError'
					? 'Sin permiso para la cámara: permítela en los ajustes del sitio.'
					: name === 'NotFoundError'
						? 'No se encontró ninguna cámara.'
						: `No se pudo abrir la cámara: ${e instanceof Error ? e.message : String(e)}`;
		} finally {
			starting = false;
		}
	}

	function switchCamera() {
		if (devices.length < 2) return;
		const i = devices.findIndex((d) => d.deviceId === deviceId);
		deviceId = devices[(i + 1) % devices.length].deviceId;
		void start();
	}

	function shoot() {
		if (!video || !video.videoWidth) return;
		const canvas = document.createElement('canvas');
		canvas.width = video.videoWidth;
		canvas.height = video.videoHeight;
		canvas.getContext('2d')!.drawImage(video, 0, 0);
		canvas.toBlob(
			(blob) => {
				if (!blob) return;
				oncapture(new File([blob], 'camara.jpg', { type: 'image/jpeg' }));
				open = false;
			},
			'image/jpeg',
			0.92
		);
	}

	$effect(() => {
		if (!dialog) return;
		if (open && !dialog.open) {
			dialog.showModal();
			void start();
		} else if (!open && dialog.open) {
			dialog.close();
			stop();
		}
	});
	onDestroy(stop);
</script>

<dialog bind:this={dialog} class="card cam" onclose={() => { open = false; stop(); }}>
	<h2>Cámara</h2>
	{#if error}
		<p class="warning small">{error}</p>
	{:else}
		<!-- svelte-ignore a11y_media_has_caption -->
		<video bind:this={video} playsinline muted></video>
		{#if starting}<p class="small muted"><span class="spinner"></span> Abriendo la cámara…</p>{/if}
	{/if}
	<div class="row actions">
		<button onclick={() => (open = false)}>Cancelar</button>
		{#if devices.length > 1}<button onclick={switchCamera} title="Cambiar de cámara">🔄 Cambiar cámara</button>{/if}
		<button class="primary" onclick={shoot} disabled={!!error || starting}>📸 Hacer foto</button>
	</div>
</dialog>

<style>
	.cam {
		width: min(720px, calc(100vw - 2rem));
		color: var(--text);
	}
	.cam::backdrop {
		background: rgb(0 0 0 / 0.6);
	}
	video {
		width: 100%;
		max-height: 60dvh;
		background: #000;
		border-radius: var(--radius-sm);
	}
	.actions {
		justify-content: flex-end;
		margin-top: 0.8rem;
	}
</style>
