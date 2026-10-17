# 先生 Sensei

Plataforma para aprender a **leer** japonés desde el español. Un SRS (FSRS) y diccionarios abiertos son la fuente de verdad; Gemini hace de tutor: conversa por turnos, prepara quizzes, escribe lecturas graduadas, explica frases y fotos, y crea mnemotecnias.

Es un **sitio estático** (GitHub Pages) y una **PWA**: todo corre en tu navegador, se puede instalar como app (escritorio y móvil) y abre sin conexión. La base de datos (SQLite en WebAssembly) se guarda en el almacenamiento privado del navegador (OPFS); no hay servidor ni cuentas. Sin conexión funciona todo salvo lo que usa Gemini.

## Usarlo

1. Abre el sitio publicado (`https://<usuario>.github.io/<repo>/`) en Chrome, Edge, Firefox o Safari recientes, fuera del modo incógnito.
2. La primera vez descarga el diccionario: **palabras comunes** (~5 MB, recomendado) o **JMdict completo** (~30 MB). Se puede cambiar después en Ajustes sin perder el progreso.
3. Pega tu API key de Gemini en **Ajustes → API key de Gemini** (gratis en [Google AI Studio](https://aistudio.google.com/apikey)). Sin key funcionan el SRS, las lecciones y el diccionario; no el tutor, las lecturas, el explicador ni las mnemotecnias.

### La API key en el navegador

La key se guarda solo en ese navegador y nunca viaja en exportaciones ni copias. Pero **cualquiera con acceso a ese navegador puede usarla**. Recomendado:
- En Google Cloud, restríngela por *referrer* a `https://<usuario>.github.io/*` y solo a la «Generative Language API».
- Pon un presupuesto en **Costos** y, si quieres, activa «Bloquear Gemini al superarlo».

### Sincronizar PC ↔ móvil (sin internet)

**Sistema → Sincronizar**: pulsa «Iniciar» en un dispositivo y «Unirme» en el otro.
1. **Emparejamiento por sonido:** se emparejan por **ultrasonido** (casi inaudible), con QR o copiar y pegar como respaldo.
2. **Transferencia:** los datos viajan **directamente por tu red local** (WebRTC, IP a IP), sin servidores ni internet.
3. **Código:** la primera vez, ambos muestran el mismo código de 4 dígitos para confirmar. Con «Recordar», no vuelve a pedirse.
4. **Quién gana:** Sensei decide solo quién tiene lo más nuevo. Si los dos cambiaron, eliges; lo descartado queda en una copia.
5. **Requisitos:** misma WiFi (o el móvil como punto de acceso) y haber abierto Sensei una vez con internet en cada uno.
6. **Diagnóstico:** `/lab/ultrasonido` y `/lab/red-local`.

### Tus datos

- Viven en **este navegador**: otro navegador o el móvil tienen los suyos. Para pasar el progreso: **Sincronizar**, o **Datos → Exportar** en uno e **Importar** en el otro.
- Si borras los datos del sitio en el navegador, se pierden. Sensei pide almacenamiento persistente y hace copias automáticas, pero descarga un .zip de vez en cuando.
- Solo una pestaña a la vez puede tener la base abierta.

### Migrar desde la versión con servidor

Si usabas la versión anterior (Bun + `data/sensei.db`):

```bash
bun run export:local            # data/sensei.db → data/sensei-export-AAAA-MM-DD.zip
```

Luego, en el sitio: **Datos → Importar** ese .zip, y vuelve a pegar la API key.

## Desarrollo

Requisitos: [Bun](https://bun.sh) ≥ 1.3.

```bash
bun install
bun run build:dict              # genera static/dict (diccionario común; ~10 s)
bun run dev                     # http://localhost:5173
```

`bun run build:dict --variants common,full` genera también el completo. Descarga de [jmdict-simplified](https://github.com/scriptin/jmdict-simplified) a `data/raw/` (caché).

| Comando | Qué hace |
|---|---|
| `bun run dev` | servidor de desarrollo (Vite) |
| `bun run build` | sitio estático en `build/` (`BASE_PATH=/repo` para GitHub Pages) |
| `bun run preview` | sirve `build/` |
| `bun run build:dict` | genera el diccionario publicable en `static/dict/` |
| `bun run export:local` | exporta una base de la versión con servidor a .zip |
| `bun test` | tests (SRS, corrección, tokens, tutor con Gemini simulado, adaptador SQLite WASM, enrutador) |
| `bun run check` | svelte-check / TypeScript |
| `bun run db:generate` | genera una migración tras cambiar `src/lib/server/db/schema.ts` |

### Despliegue

`.github/workflows/main.yml`: en cada push a `main` instala, comprueba tipos, pasa los tests, genera el diccionario (común + completo), compila con `BASE_PATH=/<repo>` y publica `build/` en la rama `gh-pages`. En el repo: **Settings → Pages → Deploy from a branch → `gh-pages`**.

## Qué incluye

- **Bienvenida y guía**: un asistente inicial explica el método y fija tu ritmo. La página **Guía** documenta cada pantalla, y el botón «?» de cada una lleva a su sección.
- **Inicio**: el **siguiente paso recomendado y por qué**, tu posición en la **ruta de hitos** (kana → 50 → 100 → 300 → 600 → 1000 → 2000 kanji), repasos pendientes, cupo de lecciones, racha, progreso, previsión, puntos débiles y confusiones.
- **Diagnóstico de kana**: solo los kana que fallas o en los que dudas (> 4 s) entran al SRS.
- **Lecciones**: componentes → kanji (mnemotecnia en español, lecturas, vocabulario) → mini-quiz. Orden "componentes + frecuencia". El vocabulario se desbloquea cuando sus kanji pasan a repaso.
- **Repaso SRS (FSRS)**: lectura en romaji que se convierte en vivo a kana; significado en español con tolerancia a tildes y erratas; "¿Por qué?" pide la explicación al tutor; las confusiones se detectan solas.
- **Tutor** (chat por turnos con function calling): conversación-quiz, quiz a medida, explicador, detective de confusiones y libre. Recuerda tus sesiones mediante resúmenes y notas.
  - **En toda la app:** el botón 話 abre un panel lateral que sabe qué estás viendo.
  - **Actúa por ti:** directo con «Deshacer» (cola de lección, SRS, frases, notas) o con «Confirmar» (ritmo, objetivo, apartar tarjeta, mnemotecnia nueva, reiniciar ítem). Nunca reinicia todo, importa ni borra sesiones.
  - **Sesiones:** se guardan al primer mensaje; tabla ordenable con buscador, filtro, renombrar y borrar.
  - **Errores pasajeros de Gemini:** reintento automático y botón «Reintentar».
  - `?tutor=1` en cualquier URL abre el panel.
- **Lectura graduada** (i+1), **Explicador** (texto o foto), **furigana adaptativa**, validación de lecturas contra JMdict.
- **Mapa de kanji**, ficha por kanji (con orden de trazos de KanjiVG), **estadísticas** y **ajustes**.

### El viaje: del primer kanji a leer lo que quieres

Gramática (65 puntos), diccionario que entiende conjugaciones, kanji parecidos, biblioteca (.txt/.srt/.epub) con plan de estudio, frases en contexto, relectura espaciada y velocidad, variedad de fuentes, tarjetas que se resisten, objetivo con fecha, informe semanal, **calibración del SRS** (fsrs-rs en WebAssembly) y test de nivel. Todo alimenta el **siguiente paso** de Inicio.

### Costos de Gemini (`/costos`)

Cada llamada guarda tokens y costo estimado con el precio de ese día: gasto del mes con proyección, por día, por función y por modelo, sesiones más caras y últimas llamadas. Precios editables con tramos por fecha, presupuesto mensual con aviso (y bloqueo opcional), «≈ $…» al generar, y selector de modelos con precio y estimación según tu uso (Ajustes → «Elegir…»). Es una estimación: la factura real está en Google AI Studio.

### Datos y copias (`/datos`)

Exportar/importar .zip (importar reemplaza, con copia previa), copias automáticas diarias y manuales en el navegador (7 días, descargables), reinicios por tipo, ítem, tutor, contenido generado o costos, y restablecer ajustes. Las operaciones destructivas piden escribir REINICIAR o REEMPLAZAR.

## Fuentes y licencias

| Fuente | Uso | Licencia |
|---|---|---|
| KANJIDIC2 | kanji, lecturas, significados (incl. español) | CC-BY-SA 4.0 (EDRDG) |
| KRADFILE / RADKFILE | componentes de cada kanji | CC-BY-SA 4.0 (EDRDG) |
| JMdict (inglés + español) | vocabulario y búsqueda | CC-BY-SA 4.0 (EDRDG) |
| Ejemplos de Tatoeba (vía JMdict) | frases de ejemplo | CC-BY 2.0 FR |
| KanjiVG (bajo demanda, jsDelivr) | orden de trazos; trazos de 先生 en el icono | CC-BY-SA 3.0 |

El diccionario publicado (`dict/`) deriva de estas fuentes y se distribuye bajo las mismas licencias.
