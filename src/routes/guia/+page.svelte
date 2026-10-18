<script lang="ts">
	import type { PageProps } from './$types';
	import { aiMode, aiUi } from '#lib/client/ai.svelte.ts';
	import { CONFUSION_HINT, KANA_SAMPLE_FAILS, KANA_SLOW_MS, MASTERED_DAYS, PLACEMENT_PASS, READABLE_DAYS } from '#lib/algoConstants.ts';

	let { data }: PageProps = $props();
	const j = $derived(data.journey);
	// Sin IA no se documentan las pantallas que no existen (tutor, lectura graduada, explicador, costos).
	const ai = $derived(aiUi());
	const AI_SECTIONS = new Set(['tutor', 'lectura', 'explicar', 'costos']);

	const TOC = [
		['metodo', 'El método'],
		['inicio', 'Inicio y siguiente paso'],
		['kana', 'Diagnóstico de kana'],
		['nivel', 'Test de nivel'],
		['leccion', 'Lecciones'],
		['gramatica', 'Gramática'],
		['parecidos', 'Kanji parecidos'],
		['repaso', 'Repaso (SRS)'],
		['frases', 'Frases en contexto'],
		['sanguijuelas', 'Tarjetas que se resisten'],
		['furigana', 'Furigana y diccionario'],
		['biblioteca', 'Biblioteca'],
		['velocidad', 'Relectura y velocidad'],
		['tutor', 'Tutor'],
		['lectura', 'Lectura graduada'],
		['explicar', 'Explicador'],
		['kanji', 'Mapa de kanji'],
		['estadisticas', 'Estadísticas'],
		['informe', 'Informe semanal'],
		['objetivo', 'Objetivo con fecha'],
		['calibrar', 'Calibrar el SRS'],
		['ajustes', 'Ajustes'],
		['costos', 'Costos de Gemini'],
		['sincronizar', 'Sincronizar dispositivos'],
		['datos', 'Datos y copias'],
		['por-dentro', 'Cómo funciona por dentro'],
		['ruta', 'La ruta'],
		['problemas', 'Problemas frecuentes']
	];
</script>

<svelte:head><title>Guía · Sensei</title></svelte:head>

<h1>Guía</h1>
<p class="muted">Cómo funciona Sensei y por qué cada cosa está donde está. ¿Prefieres el recorrido paso a paso? <a href="/bienvenida">Abre la bienvenida</a>.</p>

<nav class="card toc" aria-label="Índice">
	{#each TOC.filter(([id]) => ai || !AI_SECTIONS.has(id)) as [id, label] (id)}<a href="#{id}">{label}</a>{/each}
</nav>
{#if !ai}
	<p class="small muted"><strong>{aiMode() === 'off' ? 'Modo sin IA' : 'IA sin activar'}</strong>: esta guía omite el tutor, la lectura graduada, el explicador y los costos. <a href="/ajustes#ia">Cambiar en Ajustes</a>.</p>
{/if}

<article class="guide">
	<section id="metodo" class="card">
		<h2>El método</h2>
		<p>El objetivo es <strong>leer</strong>. Para eso hacen falta tres cosas, en este orden:</p>
		<ol>
			<li><strong>Reconocer kanji</strong> — su significado y sus lecturas. Se aprenden por <em>componentes</em> (piezas visuales con nombre en español) y en orden de <em>frecuencia</em>: lo que más vas a ver, primero.</li>
			<li><strong>Reconocer palabras</strong> — el vocabulario se desbloquea cuando sus kanji pasan a repaso. Una palabra como 日本 se lee distinto que sus kanji por separado.</li>
			<li><strong>Leer en contexto</strong> — textos a tu nivel (hipótesis i+1: casi todo conocido y un poco nuevo) y textos reales.</li>
		</ol>
		<p>
			Todo se sostiene sobre un <strong>SRS</strong> (repetición espaciada): las tarjetas vuelven justo antes de que las olvides. La IA
			(Gemini) es el tutor que explica, pregunta y escribe; los <strong>diccionarios</strong> (KANJIDIC2, JMdict) son la fuente de
			verdad contra la que se comprueba lo que dice.
		</p>
	</section>

	<section id="inicio" class="card">
		<h2>Inicio y «siguiente paso»</h2>
		<p>Cada vez que abres Sensei, Inicio decide qué conviene hacer ahora, con este orden de prioridad:</p>
		<ol>
			<li>Diagnóstico de kana, si no lo hiciste.</li>
			<li><strong>Repasos pendientes</strong> — siempre antes que lo nuevo.</li>
			<li>Lecciones, si te queda cupo hoy.</li>
			<li>Lectura graduada (desde 20 kanji), confusiones frecuentes, puntos débiles con el tutor.</li>
		</ol>
		<p>Cada recomendación explica <em>por qué</em>. Debajo verás tu posición en <a href="#ruta">la ruta</a>.</p>
	</section>

	<section id="hoy" class="card">
		<h2>Sesión de hoy</h2>
		<p>
			<a href="/hoy">Hoy</a> encadena lo que toca en el orden correcto, sin volver a Inicio entre medias: <strong>repasos</strong> (con
			tope, para que no se coman la sesión) → <strong>lección</strong> → <strong>lectura corta</strong> → <strong>cierre</strong> con el
			tutor (o un resumen en números, sin API key).
		</p>
		<ul>
			<li>Eliges cuánto tiempo tienes: 10, 20 o 40 minutos. Los tiempos se calculan con tu ritmo real (lo que tardas por repaso).</li>
			<li>Una barra arriba muestra el progreso en cualquier pantalla; puedes saltar un bloque o terminar cuando quieras.</li>
			<li>La sesión es de este dispositivo y de hoy: mañana empieza otra. El recordatorio de repasos abre esta página.</li>
		</ul>
	</section>

	<section id="kana" class="card">
		<h2>Kana: desde cero o con una prueba</h2>
		<p>
			En la bienvenida dices tu punto de partida (hiragana, katakana y kanji). Si no sabes kana, las lecciones empiezan por ellos:
			<strong>fila a fila</strong> (あいうえお, かきくけこ…), 10 al día, cada uno con su sonido 🔊, una imagen para recordarlo, una
			palabra real, sus parecidos (ソ/ン, ぬ/め) y la práctica del trazo. Después vienen los kana con ゛ y ゜, los combinados (きゃ), la
			っ pequeña, y en katakana la raya ー y los extendidos (ファ, ティ).
		</p>
		<ul>
			<li><strong>Los kanji y la gramática esperan</strong> a que termines el hiragana básico (46): todo se lee con kana. El katakana sigue en paralelo a los primeros kanji.</li>
			<li><strong>Repaso</strong>: ves el kana y escribes el romaji; y al revés, oyes o ves el sonido y eliges el kana entre parecidos. Con «Repasos de escritura» (Ajustes) también los trazas.</li>
			<li><strong>Romaji de apoyo</strong>: bajo las lecturas en kana (fichas, lecciones, diccionario, repasos) aparece el romaji pequeño solo mientras haya algún kana que aún no lees con soltura. Desaparece solo.</li>
			<li><strong>Prueba de kana</strong> (adaptativa): una muestra corta; con muchos fallos, esa escritura se aprende desde cero. Si va bien, sigue con el resto: lo correcto y rápido queda en repaso; lo fallado o lento (más de 4 s), a aprender.</li>
			<li><strong>Practicar lectura</strong>: en la página Kana, palabras reales escritas solo con los kana que ya estudiaste.</li>
		</ul>
	</section>

	<section id="nivel" class="card">
		<h2>Test de nivel</h2>
		<p>
			Si ya sabes algunos kanji, el <a href="/nivel">test de nivel</a> te pregunta 5 por franja de tu orden de aprendizaje. Las
			franjas que dominas (4/5) se marcan como conocidas, con sus componentes, y entran «en repaso» repartidas en 2 semanas: así se
			confirman sin saturarte y no gastas lecciones en lo que ya sabes. Si empiezas de cero, sáltalo.
		</p>
	</section>

	<section id="leccion" class="card">
		<h2>Lecciones</h2>
		<p>
			Una lección son hasta 5 kanji precedidos por los componentes que necesitan, o 5 palabras. Primero los estudias (significado,
			lecturas, mnemotecnia, vocabulario de ejemplo) y luego un mini-quiz: lo que falles vuelve al final hasta acertarlo. Al terminar,
			quedan en tu SRS.
		</p>
		<ul>
			<li><strong>Cupo diario</strong>: kanji y palabras nuevas por día (Ajustes). Lo aprendido hoy cuenta desde la hora de inicio del día.</li>
			<li><strong>Freno automático</strong>: con {data.brake.half}+ repasos pendientes el cupo baja a la mitad; con {data.brake.stop}+ se pausa.</li>
			<li><strong>Mnemotecnias</strong>: las crea el tutor la primera vez a partir de los nombres de los componentes y se guardan.</li>
			<li>
				<strong>Componentes</strong>: no son palabras, sino piezas que se repiten dentro de los kanji. Cada uno trae qué dibuja, por qué
				tiene ese nombre, qué aporta (pista de significado, de sonido o solo de forma) y su forma completa si es una variante (氵 es 水).
				Ves ejemplos con la pieza <em>resaltada en color</em> dentro de cada kanji, en cuáles de esta lección la vas a usar y una
				pregunta rápida: «¿en cuál aparece?».
			</li>
		</ul>
	</section>

	<section id="gramatica" class="card">
		<h2>Gramática</h2>
		<p>
			Saber kanji no basta: sin reconocer partículas y conjugaciones, 「食べさせられた」 es ruido aunque conozcas 食. La pista de
			gramática (65 puntos, de は/が a la causativa-pasiva y las partículas de manga) se desbloquea según los kanji que sabes y entra en
			las lecciones (2 por día por defecto). Se repasa reconociendo: ves una frase de ejemplo con el patrón resaltado y eliges qué
			expresa. Las lecturas graduadas usan la gramática que ya estudiaste más un punto nuevo, y el Explicador te ofrece «aprender este
			punto» cuando lo encuentra en un texto real.
		</p>
	</section>

	<section id="parecidos" class="card">
		<h2>Kanji parecidos</h2>
		<p>
			Dos kanji parecidos se confunden menos si se comparan en el momento de aprender el segundo. Al estudiar 末, si ya sabes 未, la
			lección te avisa «¡Ojo! Se parece a…» con un consejo para distinguirlos. Los pares se calculan por componentes compartidos y
			trazos, más una lista de pares clásicos. También aparecen en el diccionario y al fallar un repaso.
		</p>
	</section>

	<section id="repaso" class="card">
		<h2>Repaso (SRS)</h2>
		<p>Cada ítem tiene tarjetas: <span class="pill meaning">significado</span> (escribe en español) y <span class="pill reading">lectura</span> (escribe en romaji; se convierte a kana).</p>
		<ul>
			<li>Acierto → <strong>Difícil / Bien / Fácil</strong> (teclas 1/2/3; Enter = Bien). Elige con honestidad: decide cuándo vuelve.</li>
			<li>Fallo → vuelve pronto. Si fue una errata o un sinónimo válido, usa <strong>Contar como correcta</strong>.</li>
			<li><strong>¿Por qué?</strong> pide al tutor una explicación breve del error.</li>
			<li>Si respondes el significado de otro kanji que ya estudiaste, se registra una <strong>confusión</strong>.</li>
			<li>En vocabulario, si escribes la lectura del kanji suelto en vez de la de la palabra, te avisa sin contarlo como fallo.</li>
		</ul>
		<p>Estados: <em>aprendiendo</em> (pasos iniciales) → <em>en repaso</em> → <em>dominado</em> (intervalo de 21+ días).</p>
	</section>

	<section id="frases" class="card">
		<h2>Frases en contexto</h2>
		<p>
			Una palabra aislada es ambigua: 生 se lee せい en 先生, なま en 生ビール, い en 生きる. Una frase la desambigua y se recuerda mejor.
			En el Explicador, las lecturas graduadas y la Biblioteca, «＋ Guardar frase» crea una tarjeta: ves la frase con la palabra
			resaltada y escribes su lectura. Además, al responder una tarjeta de vocabulario verás una frase de ejemplo (tuya o de Tatoeba).
		</p>
		<p>
			<strong>Variedad de fuentes</strong>: los kanji y palabras se muestran a veces en mincho, letra a mano, pincel o fuente de manga.
			Reconocer 書 en una sola fuente no significa reconocerlo en una viñeta. Se desactiva en Ajustes.
		</p>
	</section>

	<section id="sanguijuelas" class="card">
		<h2>Tarjetas que se resisten</h2>
		<p>
			Pocas tarjetas consumen gran parte del tiempo de repaso. Cuando fallas 6+ veces algo ya aprendido, Sensei te lo dice en el
			momento y en Estadísticas, y propone cambiar de estrategia: una <strong>mnemotecnia nueva</strong> (distinta y con tus
			intereses), <strong>ver con qué lo confundes</strong> o <strong>apartarla 7 días</strong> para volver con la cabeza fresca.
		</p>
	</section>

	<section id="furigana" class="card">
		<h2>Furigana y diccionario</h2>
		<ul>
			<li><strong>Adaptativa</strong>: la furigana se oculta en los kanji cuya lectura dominas (tarjeta de lectura en repaso con 7+ días de estabilidad). Pasa el ratón para verla.</li>
			<li><strong>Toca o pasa el ratón</strong> sobre cualquier palabra japonesa para abrir el diccionario, añadirla al SRS o reiniciarla.</li>
			<li>
				El diccionario <strong>entiende conjugaciones</strong>: tocas 見られなかった y te dice «見る + pasiva + negativo + pasado». Leer
				textos reales es leer formas conjugadas.
			</li>
			<li>Lecturas con <span class="unverified jp">subrayado punteado</span>: el diccionario no confirma la lectura que dio la IA. Desconfía.</li>
		</ul>
	</section>

	<section id="biblioteca" class="card">
		<h2>Biblioteca: del texto real al plan</h2>
		<p>
			Aprender lo que necesitas para algo que <em>quieres</em> leer motiva más que una lista. Pega un capítulo, sube subtítulos (.srt) o
			un EPUB (se divide por capítulos). Sensei lo analiza sin IA (diccionario + deconjugador) y te dice:
		</p>
		<ul>
			<li>qué % de sus palabras ya repasas y qué % de sus kanji conoces;</li>
			<li>qué palabras estudiar primero: las más frecuentes que no sabes, hasta subir ~15 puntos la cobertura;</li>
			<li>con un clic las pone (con sus kanji y componentes) <strong>a la cabeza de tus lecciones</strong>;</li>
			<li>y puedes fijar un <a href="#objetivo">objetivo con fecha</a>: «leer este texto para tal día».</li>
		</ul>
		<p>Luego lo lees con tu furigana adaptativa y el diccionario al tacto, cronometrando la lectura.</p>
	</section>

	<section id="velocidad" class="card">
		<h2>Relectura y velocidad</h2>
		<p>
			Releer un texto ya visto mejora la fluidez más que leer siempre algo nuevo. Cada lectura cronometrada (biblioteca o lectura
			graduada) programa una relectura a los 1, 3, 7, 21 y 60 días; Inicio te la sugiere («¿la lees ahora sin furigana?»). El
			<a href="/velocidad">reto de velocidad</a> semanal mide caracteres por minuto con ~300 caracteres a tu nivel: es un indicador de
			progreso más fiel que el número de kanji.
		</p>
	</section>

	{#if ai}
	<section id="tutor" class="card">
		<h2>Tutor</h2>
		<p>Conoce tu perfil, tus fallos y tus confusiones, y consulta el diccionario antes de afirmar algo. Modos:</p>
		<ul>
			<li><strong>Conversación-quiz</strong> — te pregunta por turnos y adapta la dificultad.</li>
			<li><strong>Quiz a medida</strong> — pide el tema; los quizzes se corrigen solos y quedan registrados.</li>
			<li><strong>Explicador</strong> — pega frases y las desglosa.</li>
			<li><strong>Detective de confusiones</strong> — ejercicios para separar pares que confundes.</li>
			<li><strong>Libre</strong> — cualquier cosa: dudas, tu plan, tu biblioteca, añadir cosas a tus lecciones…</li>
		</ul>
		<p>
			<strong>En toda la app</strong>: el botón <span class="jp">話</span> abre el tutor en un panel lateral sin salir de la pantalla.
			Sabe lo que estás viendo (un kanji, la tarjeta que fallaste, el texto que lees): lo verás como un chip «📎 Contexto» encima del
			cuadro de texto, que puedes quitar. También hay botones «Preguntar al tutor» en el repaso, las fichas y el diccionario.
		</p>
		<p><strong>Qué puede hacer por ti</strong>:</p>
		<ul>
			<li>
				<strong>Directamente</strong> (verás un comprobante con «Deshacer»): poner kanji, palabras o gramática en tu próxima lección,
				añadirlos al SRS, guardar frases como tarjetas, guardar un texto en la Biblioteca, recordar u olvidar cosas sobre ti.
			</li>
			<li>
				<strong>Con tu confirmación</strong> (te propone y pulsas «Confirmar»): cambiar tu ritmo diario, crear o quitar un objetivo,
				apartar una tarjeta que se resiste, darte una mnemotecnia nueva o reiniciar un ítem.
			</li>
			<li>
				<strong>Mostrar</strong>: fichas de kanji, palabras y gramática; textos japoneses con tu furigana y diccionario al tocar; botones
				de respuesta rápida; enlaces a la parte de la app que toque.
			</li>
			<li><strong>Consultar</strong>: tu plan y siguiente paso, estadísticas, informe semanal, biblioteca, velocidad, parecidos y ejemplos.</li>
			<li>
				<strong>Nunca</strong>: reiniciar todo, importar o restaurar copias ni borrar sesiones. Eso solo lo haces tú desde
				<a href="/datos">Datos</a>.
			</li>
		</ul>
		<p>
			<strong>Sesiones</strong>: una conversación solo se guarda cuando envías el primer mensaje; su nombre es ese mensaje, hasta que la
			resumes o la renombras. En <a href="/tutor">Tutor</a> las ves en una tabla: ordenar por columna (clic: ascendente, descendente,
			normal), buscar por nombre, filtrar por tipo, renombrar y borrar.
		</p>
		<p>
			<strong>Memoria</strong>: «Terminar y resumir» guarda un resumen; las sesiones inactivas se resumen solas. El tutor también guarda
			notas sobre ti (pídele «¿qué sabes de mí?» u «olvida que…»). Todo se borra desde <a href="/datos">Datos</a> → memoria del tutor.
		</p>
	</section>

	<section id="lectura" class="card">
		<h2>Lectura graduada</h2>
		<p>
			Textos originales (manga, novela, carteles, videojuego, web, noticia) que usan casi solo los kanji que ya has visto y 1-2 nuevos
			de tu siguiente lección. Muestra la cobertura real y los kanji «fuera de nivel» si se cuela alguno. Traducción por línea, audio y
			preguntas de comprensión. Recomendado desde ~20 kanji.
		</p>
	</section>

	<section id="explicar" class="card">
		<h2>Explicador</h2>
		<p>
			Pega texto o una foto (también con Ctrl+V). Transcribe, separa en palabras con lectura, forma base y función, traduce y explica la
			gramática. Añade al SRS lo que quieras aprender: si la palabra no está en el diccionario, se crea como palabra propia.
		</p>
	</section>
	{/if}

	<section id="kanji" class="card">
		<h2>Mapa de kanji</h2>
		<p>Todos los kanji en tu orden de aprendizaje, coloreados por estado. Cada ficha muestra componentes, mnemotecnia, orden de trazos y vocabulario, y permite añadirlo o reiniciarlo.</p>
	</section>

	<section id="estadisticas" class="card">
		<h2>Estadísticas</h2>
		<p>Actividad y precisión de los últimos 30 días, previsión de repasos (útil para no sobrecargarte), progreso por tipo y los ítems que más fallas.</p>
	</section>

	<section id="informe" class="card">
		<h2>Informe semanal</h2>
		<p>
			Cada semana, el <a href="/informe">informe</a> resume tu actividad, la <strong>retención real</strong> por tipo (aciertos en
			tarjetas que llevaban 1+ día sin verse), tu velocidad, las confusiones nuevas y el estado de tu objetivo, y propone 2-3 ajustes
			concretos («bajar a 8 kanji/día una semana»). Se guarda en la memoria del tutor.
		</p>
	</section>

	<section id="objetivo" class="card">
		<h2>Objetivo con fecha</h2>
		<p>
			«Quiero leer Dragon Quest XI en marzo»: eliges cuántos kanji necesitas (o lo calcula un texto de la Biblioteca) y la fecha.
			Sensei calcula el ritmo necesario, lo compara con tu ritmo configurado y con lo que realmente haces, y te avisa si te desvías.
			Así la ruta de hitos se convierte en tu ruta personal.
		</p>
	</section>

	<section id="calibrar" class="card">
		<h2>Calibrar el SRS</h2>
		<p>
			FSRS empieza con parámetros de una persona media. Con 400+ repasos, en Ajustes → SRS puede ajustarlos a <em>tu</em> memoria:
			te muestra la carga de repasos prevista antes y después, y al aplicar reprograma todas las tarjetas desde su historial (con copia
			previa). También puedes elegir la <strong>retención objetivo</strong>: más alta = más repasos.
		</p>
	</section>

	<section id="ajustes" class="card">
		<h2>Ajustes</h2>
		<p>
			Ritmo diario, hora de inicio del día, furigana, audio y voz, y modelos de Gemini: tres perfiles (🌱 Ahorro, ⚖ Equilibrado —el
			recomendado y por defecto— y 🎓 Máximo) con lo que te habría costado tu último mes con cada uno, o a mano. «Elegir…» abre una tabla con los modelos de
			tu API key: precio, contexto, si razonan, lo que te habrían costado tus últimos 30 días con cada uno y cuánto más caro o barato
			es frente al actual. El tema (☀/☾/◐) y la voz se guardan por dispositivo.
		</p>
		<ul>
			<li>
				<strong>Inteligencia artificial</strong>: «IA activada» o «Sin IA». Sin IA desaparecen el tutor, las lecturas graduadas, el
				explicador, los costos, «¿Por qué?» y los botones de generar; el resto funciona con el contenido ya preparado (mnemotecnias de
				los primeros 500 kanji). El modo actual se ve en Inicio y al pie del menú.
			</li>
			<li><strong>API key de Gemini</strong>: se pega en Ajustes y se guarda solo en este navegador (no viaja en copias automáticas ni al sincronizar; al exportar se puede incluir cifrada). Restríngela en Google Cloud a la dirección del sitio y ponle presupuesto en Costos.</li>
			<li><strong>Diccionario</strong>: «palabras comunes» (ligero) o «JMdict completo» (mejores búsquedas). Cambiar de uno a otro, o actualizar cuando se publica uno nuevo, conserva tu progreso.</li>
			<li>
				<strong>App</strong>: botón «Instalar Sensei», <strong>recordatorio de repasos</strong> (como mucho un aviso al día entre las 8 y
				las 22 h, y el número de pendientes en el icono; solo Chrome/Edge con la app instalada) y lo que se hace desde otras apps:
				<strong>Compartir → Sensei</strong> (texto o foto al Explicador; .txt/.srt/.epub a la Biblioteca), <strong>abrir con Sensei</strong>
				en el PC (también copias .zip) y atajos al mantener pulsado el icono. La pantalla no se apaga mientras repasas, lees cronometrando
				o sincronizas.
			</li>
		</ul>
	</section>

	{#if ai}
	<section id="costos" class="card">
		<h2>Costos de Gemini</h2>
		<p>
			Cada llamada a Gemini guarda sus tokens (entrada, caché, salida, razonamiento) y su costo estimado con el precio de ese día. En
			<a href="/costos">Costos</a> ves el gasto del mes y su proyección, el gasto por día, por función (tutor, lecturas, explicador,
			mnemotecnias…) y por modelo, y las sesiones del tutor más caras.
		</p>
		<ul>
			<li><strong>Qué modelo cuándo</strong>: el modelo Pro hace el tutor, las lecturas, el explicador y las mnemotecnias; Flash, los resúmenes, el informe, «¿Por qué?» y las traducciones. Se cambian en Ajustes.</li>
			<li><strong>Precios</strong>: vienen cargados (con las subidas anunciadas por fecha) y se pueden editar. Si cambias uno mal puesto, «Recalcular» rehace el historial.</li>
			<li><strong>Presupuesto</strong>: opcional; Inicio avisa al 80 % y al superarlo. Puedes activar que Gemini se bloquee al superarlo.</li>
			<li>Las lecturas, explicaciones e informes muestran «≈ $…» al generarse, y cada sesión del tutor su total.</li>
			<li>Es una estimación: la factura real está en Google AI Studio. Las sesiones largas cuestan más por turno porque cada respuesta reenvía el historial.</li>
		</ul>
	</section>
	{/if}

	<section id="sincronizar" class="card">
		<h2>Sincronizar dispositivos</h2>
		<p>
			Pasa tu progreso entre el PC y el móvil <strong>sin internet</strong>: se emparejan por <strong>sonido</strong> (ultrasonido, casi
			inaudible) y los datos viajan directamente por tu <strong>red local</strong>. Nada pasa por servidores.
		</p>
		<ol>
			<li>Abre <a href="/sincronizar">Sincronizar</a> en ambos. Pulsa «Iniciar» en uno y «Unirme» en el otro.</li>
			<li>
				Elige el mismo método en los dos (se pregunta cada vez): <strong>QR + sonido</strong> (recomendado para PC ↔ móvil: inicia el
				PC, el móvil escanea su QR y responde por ultrasonido; el PC solo necesita micrófono), <strong>sonido</strong> (se turnan emitiendo por ultrasonido; pide el
				micrófono), <strong>QR</strong> (cada uno escanea el del otro; pide la cámara) o <strong>copiar y pegar</strong> (pasas el código
				por un chat o una nota; sin permisos, pero en algunas redes no conecta). «Cambiar a:» salta a otro método sin volver atrás.
			</li>
			<li>Ambos muestran el mismo código de 4 dígitos: confírmalo en los dos (solo la primera vez; con «Recordar» ya no se pide).</li>
			<li>Sensei decide solo quién tiene lo más nuevo. Si los dos cambiaron, eliges con qué quedarte; lo descartado queda en una copia.</li>
		</ol>
		<p>
			<strong>¿Se oye o molesta?</strong> En Sincronizar → «Sonido de este dispositivo» → <a href="/lab/ultrasonido">Ajustar y calibrar</a>:
			volumen, filtro y rampa (compara la señal cruda con la suavizada) y una calibración automática entre tus dos dispositivos que busca el
			volumen más bajo que funciona. Cada dispositivo guarda el suyo.
		</p>
		<p class="small muted">
			Requisitos: misma WiFi (algunas redes de invitados aíslan los dispositivos: usa el móvil como punto de acceso) y haber abierto Sensei
			una vez con internet en cada dispositivo. Diagnóstico: <a href="/lab/ultrasonido">laboratorio de ultrasonido</a> y
			<a href="/lab/red-local">de red local</a>.
		</p>
	</section>

	<section id="datos" class="card">
		<h2>Datos y copias</h2>
		<ul>
			<li><strong>Todo vive en este navegador</strong>: cada navegador o dispositivo tiene sus propios datos. Para pasar tu progreso al móvil u otro PC, exporta aquí e importa allí.</li>
			<li><strong>Como app y sin conexión</strong>: instálala desde el navegador («Instalar app» o «Añadir a pantalla de inicio»). Tras la primera visita abre sin red; solo lo que usa Gemini necesita conexión.</li>
			<li>
				<strong>Exportar</strong>: un .zip con las secciones que elijas (progreso, tutor, biblioteca, costos, ajustes, contenido
				generado), las preferencias de este dispositivo (tema, voz, lector…) y, si quieres, la API key de Gemini cifrada con una
				contraseña. Nunca lleva los diccionarios.
			</li>
			<li>
				<strong>Importar</strong>: al elegir el .zip ves qué trae cada sección frente a lo que tienes y eliges qué cargar. Cada sección
				elegida reemplaza la tuya; las demás no cambian; el contenido generado se suma. Antes guarda una copia.
			</li>
			<li><strong>Copias</strong>: una automática al día (si hubo cambios) y una antes de cada importación, restauración o reinicio. Se borran solas a los {data.retentionDays} días, salvo la más reciente.</li>
			<li><strong>Reiniciar</strong>: todo, por tipo (reiniciar kanji arrastra el vocabulario), por ítem (desde su ficha o el diccionario), memoria del tutor, contenido generado o registro de costos. Siempre con copia previa.</li>
		</ul>
	</section>

	<section id="por-dentro" class="card">
		<h2>Cómo funciona por dentro</h2>
		<p class="muted small">
			Lo que decide qué ves, cuándo y por qué. Cada apartado explica qué es, cómo funciona y por qué te ayuda, con los números
			que usa Sensei de verdad.
		</p>
		<nav class="sub" aria-label="Apartados">
			<a href="#por-dentro-srs">Repasos (FSRS)</a>
			<a href="#por-dentro-orden">Orden y ritmo</a>
			<a href="#por-dentro-adaptativos">Lo que se adapta a ti</a>
			<a href="#por-dentro-lectura">Lectura y siguiente paso</a>
		</nav>

		<h3 id="por-dentro-srs">Repasos: el algoritmo FSRS</h3>
		<p>
			<strong>Qué es.</strong> Un modelo de tu memoria. Para cada tarjeta guarda dos números: la <strong>estabilidad</strong> (cuántos días
			tardas en bajar a un 90 % de probabilidad de recordarla) y la <strong>dificultad</strong> (lo que te cuesta ese ítem, de 1 a 10).
			Con ellos calcula, para cualquier día, la <strong>probabilidad de que la recuerdes</strong>: empieza en casi 100 % justo después de
			repasar y cae poco a poco (la «curva del olvido»).
		</p>
		<p>
			<strong>Cómo funciona.</strong> Te pregunta la tarjeta el día en que esa probabilidad baja a tu <strong>retención objetivo</strong>
			(ahora {Math.round(data.algo.retention * 100)} %; por defecto {Math.round(data.algo.defaultRetention * 100)} %). Al responder:
		</p>
		<ul>
			<li><strong>Bien / Fácil</strong>: la estabilidad crece, y crece <em>más</em> cuanto más cerca estabas de olvidarla (recordar con esfuerzo fija más) y cuanto más fácil es el ítem. Por eso los intervalos se alargan: minutos → días → semanas → meses.</li>
			<li><strong>Difícil</strong>: crece menos y la dificultad sube un poco.</li>
			<li><strong>Otra vez</strong>: la estabilidad cae, la dificultad sube y la tarjeta vuelve a aprender (minutos).</li>
		</ul>
		<p class="small">
			<strong>Ejemplo:</strong> una tarjeta con estabilidad 10 días y retención objetivo 90 % vuelve en unos 10 días. Si aciertas, su
			estabilidad pasa a, por ejemplo, 25 días y el siguiente repaso es en ~25. Con objetivo 95 % vendría antes (más repasos, menos
			olvidos); con 85 %, después (menos repasos, más fallos).
		</p>
		<p>
			<strong>Por qué ayuda.</strong> Dos efectos muy estudiados: recordar activamente (no releer) fija más, y espaciar los repasos
			rinde más que concentrarlos. Repasar justo antes de olvidar es el punto en que cada repaso cuenta más y se pierde menos tiempo.
		</p>
		<ul class="small">
			<li><strong>Estados</strong>: aprendiendo (aún en minutos u horas), en repaso, y <strong>dominado</strong> cuando la estabilidad llega a {MASTERED_DAYS} días.</li>
			<li><strong>Calibrar</strong>: FSRS empieza con parámetros de una persona media (21 números). Con {data.algo.minReviews}+ repasos, Ajustes → SRS los ajusta a tu historial y te enseña cuánto cambia tu carga diaria antes de aplicarlo.</li>
			<li>Cada ítem tiene varias tarjetas (significado y lectura; kana en los dos sentidos): se evalúan por separado y el estado del ítem es el de la peor.</li>
		</ul>

		<h3 id="por-dentro-orden">Orden y ritmo</h3>
		<ul>
			<li>
				<strong>Componentes + frecuencia.</strong> Los kanji se ordenan por lo que más aparecen en textos reales (los que no tienen dato,
				por curso escolar y trazos). Justo antes de cada kanji entran los componentes que aún no viste; si un componente es también un
				kanji, se enseña como kanji. Ejemplo: antes de 休 «descansar» ves 亻 «persona» y 木 «árbol». Así cada kanji nuevo es una combinación
				de piezas conocidas y lo primero que aprendes es lo que más vas a leer.
			</li>
			<li><strong>Kana primero.</strong> Las lecciones de kanji y la gramática esperan a que estudies los {data.algo.hiraganaCore} hiragana básicos: todo en japonés se lee con kana. El katakana sigue en paralelo, fila a fila ({data.algo.kanaPerDay} al día).</li>
			<li><strong>Vocabulario desbloqueado.</strong> Una palabra entra en las lecciones cuando <em>todos</em> sus kanji tienen el significado en repaso: la aprendes cuando ya puedes leerla.</li>
			<li><strong>Gramática por nivel.</strong> Cada punto se abre al llegar a cierto número de kanji conocidos, en el orden del currículo.</li>
			<li><strong>Cupo diario.</strong> Kanji, palabras, gramática y kana nuevos por día ({data.algo.kanjiPerDay} kanji ahora); el «día» empieza a la hora que elijas. Lo que pongas en la cola desde un texto de la Biblioteca entra antes.</li>
			<li>
				<strong>Freno automático.</strong> Con {data.brake.half}+ repasos pendientes el cupo de nuevos baja a la mitad; con {data.brake.stop}+
				se pausa. Cada ítem nuevo trae varios repasos en las semanas siguientes: frenar a tiempo evita una bola de nieve que te haga
				abandonar.
			</li>
		</ul>

		<h3 id="por-dentro-adaptativos">Lo que se adapta a ti</h3>
		<ul>
			<li><strong>Furigana adaptativa.</strong> Se oculta en una palabra cuando <em>todos</em> sus kanji tienen la lectura en repaso con {READABLE_DAYS}+ días de estabilidad. Así la ayuda desaparece justo cuando ya no la necesitas (pasa el ratón para verla).</li>
			<li><strong>Romaji de apoyo.</strong> Igual con los kana: bajo una lectura aparece el romaji solo si tiene algún kana que aún no lees con {READABLE_DAYS}+ días de estabilidad.</li>
			<li>
				<strong>Prueba de kana.</strong> Una muestra de ~15 kana por escritura; con {KANA_SAMPLE_FAILS} fallos se corta y esa escritura se
				aprende desde cero. Si va bien, sigue con el resto: correcto y en menos de {KANA_SLOW_MS / 1000} s = sabido (queda en repaso y se
				confirma en unas semanas); fallado o lento = a aprender. La lentitud cuenta porque leer exige reconocer sin pensar.
			</li>
			<li>
				<strong>Test de nivel de kanji.</strong> {data.algo.bands} franjas del orden de aprendizaje (hasta el kanji nº {data.algo.lastBand}); de
				cada una, {data.algo.perBand} kanji al azar. Apruebas una franja con {PLACEMENT_PASS} de {data.algo.perBand}; dos franjas falladas seguidas
				terminan el test. Todo lo anterior a tu última franja aprobada pasa a repaso, con el primer repaso repartido en 1-14 días: se
				verifica sin saturarte.
			</li>
			<li><strong>Tarjetas que se resisten.</strong> Con {data.algo.leechLapses} fallos ya aprendida, repetirla igual no funciona: Sensei la marca y propone cambiar de estrategia (otra imagen, contrastarla con su parecido, escribirla o apartarla unos días).</li>
			<li><strong>Confusiones.</strong> Si al fallar respondes justo lo de otro ítem que ya estudias (el significado de otro kanji, el romaji de otro kana), se registra el par. Con {CONFUSION_HINT}+ veces, se propone un ejercicio para separarlos.</li>
			<li><strong>Kanji parecidos.</strong> Se calculan por componentes compartidos (al menos la mitad en común) y número de trazos parecido (3 o menos de diferencia). Se te avisan al aprender el segundo del par, que es cuando hay que contrastarlos.</li>
		</ul>

		<h3 id="por-dentro-lectura">Lectura y siguiente paso</h3>
		<ul>
			<li><strong>Análisis de un texto.</strong> Lo corta en palabras buscando siempre la coincidencia más larga en el diccionario (y deshaciendo conjugaciones: 食べなかった → 食べる). La <strong>cobertura</strong> es el % de palabras con kanji o katakana que ya repasas.</li>
			<li><strong>Plan antes de leer.</strong> Toma las palabras desconocidas que más aparecen hasta subir la cobertura unos 15 puntos (entre 5 y 20 palabras): estudiar esas pocas primero rinde más que buscarlas mientras lees.</li>
			<li><strong>i+1.</strong> Las lecturas graduadas usan casi solo lo que sabes y un poco nuevo: el nivel en que se aprende leyendo sin frustrarse.</li>
			<li><strong>Relectura espaciada.</strong> Cada texto vuelve a proponerse a los {data.algo.rereadDays.join(', ')} días de leerlo: releer da fluidez, y se mide en caracteres por minuto.</li>
			<li><strong>Siguiente paso.</strong> Una lista con prioridad fija (bienvenida → kana → informe → repasos → tarjetas que se resisten → lecciones → relectura → velocidad → lectura → objetivo → confusiones → tutor → biblioteca): Inicio te muestra la primera que aplica y por qué.</li>
			<li><strong>Sesión de hoy.</strong> Usa tu ritmo real (la mediana de lo que tardas por repaso en los últimos 30 días): repasos con tope para que quede tiempo, luego lección, una lectura corta y el cierre, todo dentro de los minutos que elijas.</li>
		</ul>
	</section>

	<section id="ruta" class="card">
		<h2>La ruta</h2>
		<p class="muted small">Cifras orientativas: un texto real necesita además vocabulario y gramática, no solo kanji. Llevas <strong>{j.known}</strong> kanji aprendidos.</p>
		<ol class="route">
			{#each j.milestones as m (m.id)}
				<li class:reached={m.reached} class:next={j.next?.id === m.id}>
					<div class="spread">
						<strong>{m.reached ? '✓ ' : ''}{m.title}</strong>
						<span class="small muted">{m.kanji ? `${m.kanji} kanji` : m.kana ?? 'kana'}</span>
					</div>
					<div class="small">{m.unlocks}</div>
					<div class="small muted">Consejo: {m.tip}</div>
				</li>
			{/each}
		</ol>
	</section>

	<section id="problemas" class="card">
		<h2>Problemas frecuentes</h2>
		<ul>
			<li><strong>«Tengo demasiados repasos»</strong>: baja el ritmo en Ajustes y haz solo repasos unos días; el freno automático ya frena las lecciones.</li>
			<li><strong>«Siempre confundo dos kanji»</strong>: Detective de confusiones en el tutor.</li>
			<li><strong>«No suena el audio»</strong>: instala una voz japonesa (Windows: Configuración → Hora e idioma → Voz).</li>
			<li><strong>«El tutor no responde»</strong>: revisa la API key y el modelo en Ajustes (y el presupuesto en Costos, si activaste el bloqueo).</li>
			<li><strong>«Sensei ya está abierto en otra pestaña»</strong>: la base solo puede abrirse en una pestaña; cierra la otra y recarga.</li>
			<li><strong>«Me equivoqué al reiniciar»</strong>: Datos → Copias → restaura la copia «Antes de reiniciar».</li>
		</ul>
	</section>
</article>

<style>
	.sub {
		display: flex;
		flex-wrap: wrap;
		gap: 0.3rem 1rem;
		font-size: 0.9rem;
	}
	#por-dentro h3 {
		margin: 1rem 0 0.2rem;
		scroll-margin-top: 1rem;
	}
	.toc {
		display: flex;
		flex-wrap: wrap;
		gap: 0.3rem 1rem;
		font-size: 0.9rem;
	}
	.guide {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}
	section {
		scroll-margin-top: 1rem;
	}
	section:target {
		border-color: var(--accent);
	}
	section p,
	section ul,
	section ol {
		margin: 0.4rem 0;
	}
	section li + li {
		margin-top: 0.25rem;
	}
	.pill {
		padding: 0 0.4rem;
		border-radius: 4px;
		font-size: 0.85rem;
	}
	.pill.meaning {
		background: #e8e6e3;
		color: #14161b;
	}
	.pill.reading {
		background: #0b0c0f;
		color: #e8e6e3;
	}
	.route {
		list-style: none;
		padding: 0;
		display: grid;
		gap: 0.5rem;
	}
	.route li {
		border-left: 3px solid var(--line);
		padding: 0.3rem 0 0.3rem 0.8rem;
	}
	.route li.reached {
		border-left-color: var(--ok);
	}
	.route li.next {
		border-left-color: var(--accent);
		background: color-mix(in srgb, var(--accent) 6%, transparent);
	}
</style>
