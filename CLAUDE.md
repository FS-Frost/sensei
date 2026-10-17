# CLAUDE.md

Japanese-reading tutor for a Spanish speaker. **Static site (GitHub Pages)**: SvelteKit 3 SPA (`adapter-static`, `ssr = false`) + Svelte 5 (runes) + TS; the former server runs **in a Dedicated Worker** in the browser: SQLite WASM (`@sqlite.org/sqlite-wasm`, VFS `opfs-sahpool`) + Drizzle, Gemini via `@google/genai` with the user's key. Tooling/tests run on **Bun** (`bun:sqlite`). UI and all learner-facing text in Spanish; Japanese never in romaji.

## Commands

- `bun run build:dict [--variants common,full] [--no-examples]` — builds the publishable dictionary DB into `static/dict/` (gzip, parts < 100 MB, `manifest.json` with content-hash version). Needed before `dev`/`build`.
- `bun run dev` — Vite dev server
- `bun test` — tests in `tests/` (Bun, `bun:sqlite` in memory; `tests/wasm-client.test.ts` runs the browser adapter on real SQLite WASM)
- `bun run check` — svelte-check; keep at 0 errors / 0 warnings
- `bun run build` — static site in `build/`; `BASE_PATH=/<repo>` for Pages (Git Bash: prefix `MSYS_NO_PATHCONV=1` or it mangles `/repo`). CI copies `404.html` → `index.html`.
- `bun run export:local [db] [zip]` — migrate a server-era `data/sensei.db` to an import .zip
- `bun run db:generate` — after editing `src/lib/server/db/schema.ts`; migrations in `drizzle/` are bundled into the Worker (`import.meta.glob` + `_journal.json`, same hashes as Drizzle's migrator) and applied on open
- Deploy: `.github/workflows/main.yml` (check, test, build:dict common+full, build, push `build/` to `gh-pages`)

## SvelteKit 3 specifics (differ from Kit 2 knowledge)

- No `svelte.config.js`: Kit options go in the `sveltekit({...})` plugin in `vite.config.ts`.
- Alias is `#lib/*` (package.json `imports`), **imports need file extensions** (`#lib/server/db/index.ts`).
- `$app/state` (no stores), `refreshAll` (not `invalidateAll`).
- Use `Response.json()`, not `json()`.
- `$app/paths` has no `base` in Kit 3: use `#lib/client/base.ts` (`import.meta.env.BASE_URL`).
- `tsconfig.json` `types` must include `$app/types`.
- TypeScript pinned to 6.x (TS 7 has no JS API; svelte-check breaks).

## Static-site architecture («server in a Worker»)

- `src/lib/worker/backend.worker.ts` — opens SQLite (OPFS), installs/updates the dictionary, serves `/api/*` with the old handlers (`src/lib/server/api/**/+server.ts`, routed by `server/router.ts`) and page `load`s (`src/lib/server/loads/*.ts`). Web Lock `sensei-db`: a 2nd tab gets state `locked`. Starts the hourly backup scheduler.
- `src/lib/client/backend.svelte.ts` — creates the Worker, **patches `window.fetch`** so same-origin `/api/*` (with or without base) goes to the Worker (streams chunk by chunk, so the tutor SSE works unchanged); `serverLoad(route, params, url)` for universal `+page.ts`/`+layout.ts`; `backend.value` = BackendState (`starting|needs-dict|installing|ready|locked|unsupported|error`). The layout shows `Setup.svelte` until `ready` and calls `refreshAll` when it becomes ready.
- Loads run in the Worker: use `redirect`/`error` from `#lib/server/router.ts` (Kit's need `window`). Type `load` params with `ServerLoadEvent`, never annotate the return (it erases `PageData`).
- `<img src="/api/…">` / `<a href="/api/…">` bypass the Worker: fetch + blob URL (`KanjiDetail` strokes, `downloadFrom` for export/backups).
- Base path: `client/basePath.ts` MutationObserver prefixes every `<a href="/…">` with the base; `goto` from `#lib/client/nav.ts`. Compare routes with `page.url.pathname.slice(base.length)`.
- `server/db/index.ts` — platform-neutral: `db` is a Proxy over the instance set with `setDb()`; `DB` includes `$client.query` (cached statements, used by `text/analyze.ts`). `db/bun.ts` = `openDb()` for tests/scripts; `db/wasm.ts` = OPFS pool + bundled migrations; `db/wasm-client.ts` = `BunLikeClient` (bun:sqlite-shaped wrapper over oo1 so `drizzle-orm/bun-sqlite` works).
- `server/data/dictionary.ts` — download parts → `DecompressionStream('gzip')` → `importDbFile`. Update/switch variant = `pre-update` backup → snapshot user data + `_` internals → new DB → `applySnapshot` + restore internals. `_dictVersion`/`_dictVariant` internals.
- `vite.config.ts` aliases: `node:async_hooks` → `shims/async_hooks.ts` (stack-based AsyncLocalStorage), `@open-spaced-repetition/binding` → `shims/fsrs-binding.ts` (fsrs-browser WASM). Bun/tests use the real modules. No `node:*`/`Bun.*` in code reachable from the Worker (use `crypto.randomUUID`, Cache API, OPFS).
- Backups: `data/store.ts` BlobStore (OPFS folder `backups/` in the browser; `store-fs.ts` for tests). `backups.ts` functions are async and take a store.
- `server/config.ts` — no `.env`: Gemini key stored as internal setting `_geminiApiKey` (never exported), loaded by the Worker, set via `POST/DELETE /api/gemini-key` (validated with `listModels`). Optional hard budget stop (`budgetHardStop` + `assertBudget` before every call).
- No PIN/auth any more (each browser only sees its own data).

## Architecture

- `src/lib/server/db/` — schema + connection (see above). `openDb(':memory:')` from `db/bun.ts` for tests.
- `src/lib/server/import/` — build-time only (`scripts/build-dict.ts`): jmdict-simplified download (zip via fflate, `GITHUB_TOKEN` if set) → SQLite. `radicals.ts` maps RADKFILE substitute kanji (乞→𠂉, 个→𠆢, 汁→氵…) and static Spanish radical names. `order.ts` computes the single learn sequence (components before kanji; component-that-is-a-kanji is taught as kanji).
- `src/lib/server/srs/` — `fsrs.ts` (ts-fsrs wrapper, JSON-serialized card), `service.ts` (grading, confusions, reviews, interleave), `lessons.ts` (daily quota, brake at 80/150 due, vocab unlock when all kanji meaning cards are in Review).
- `src/lib/server/gemini/` — `client.ts` (models from settings override or defaults in `config.ts`), `enrich.ts` (cached mnemonics, component names, Spanish glosses/sentences), `texts.ts` (graded reading + explainer as token JSON, validated against JMdict), `tools.ts` + `tutor.ts` (chat loop).
- `src/lib/server/data/` — `snapshot.ts` (user-data .zip, `FORMAT` versioned: manifest + progress/tutor/generated/settings/content JSON; never includes `_`-prefixed internal settings), `restore.ts` (import/restore = replace, always `pre-*` backup first), `backups.ts` (BlobStore, daily auto skipped if empty or hash unchanged, 7-day retention keeping newest, hourly scheduler started by the Worker), `reset.ts` (progress all/groups/item, tutor, generated; "kanji" group cascades components+vocab).
- `src/lib/server/guide.ts` — `nextSteps` (prioritized "what now + why": welcome → kana → report → reviews → leeches → lessons → reread → speed → reading → goal → confusions → tutor → library), `goalStatus`, `journey`/`MILESTONES`. `/` redirects to `/bienvenida` when `onboardingDone` is false and there are no cards.
- `src/lib/grammar.ts` — curated grammar track (`GRAMMAR`, ids stable: they are card keys). Meanings must stay unique (used as multiple-choice distractors; tested).
- `src/lib/deinflect.ts` — rule-based deinflector (Yomichan-style, type flags). `lookupInflected` (items.ts) validates candidates by JMdict POS.
- `src/lib/server/text/` — `analyze.ts` (offline tokenizer: longest match ≤14 chars against `vocab_form` + deinflection; coverage + study plan), `library.ts` (txt/srt/epub import, reading log, reread intervals `REREAD_DAYS`, speed), `sentences.ts` (mined sentence cards, offline speed text from Tatoeba).
- `src/lib/server/srs/` additions — `optimizer.ts` (fsrs-rs via `@open-spaced-repetition/binding`, aliased to fsrs-browser WASM in the site: `computeParameters`, workload compare, replay history to reschedule; skips placement cards), `placement.ts` (level test; cards created with `createdAt` in the past so they don't consume today's quota), `lessons.ts` (study queue first: queued kanji with their missing components; queued vocab ignores unlock; grammar lessons).
- `src/lib/server/report.ts` — weekly metrics (retention = review answers with previous answer ≥1 day earlier) + Gemini/fallback text; appended to learner notes.
- New item types: `grammar` (facet meaning, answerMode `choice`) and `sentence` (key = mined_sentence.id, facet reading). `LEECH_LAPSES = 6` (FSRS lapses only count failures from Review state).
- `src/lib/server/gemini/pricing.ts` + `usage.ts` — cost tracking. `DEFAULT_PRICES` (USD/1M, dated tiers `from`, prefix match via `priceKey`), overridable per model by setting `modelPrices`. `recordUsage` writes one `gemini_usage` row per call (cost frozen at call time; `recomputeCosts` rewrites history). `costReport`/`budgetStatus`/`sessionCosts` feed `/costos`, Inicio and the sessions table. `trackCost(fn)` (AsyncLocalStorage) sums nested calls of one operation → `cost` in reading/explain/report responses (`CostNote.svelte`). `priceKey` prefix match only with a version suffix (`-preview|-latest|-exp|-customtools|-<digit>`), so `…-flash-tts` doesn't inherit `…-flash`. Tiers may carry `long` (prompt > 200k).
- Model picker: `GET /api/models` = `listModels()` (10-min cache, `isCompatibleModel` filter) + `priceSummary` + per role `usd` = last-30-day calls of that role (`FEATURE_ROLE` in usage.ts — keep in sync with `models(db).pro/.flash` callers) repriced with the candidate (`projectCost`; `mixCost` 90/10 if no usage). `ModelPicker.svelte` computes «Relativo» against the form's current value.
- Client: `src/lib/client/` (api/SSE, backend bridge, base path, markdown+furigana renderer, TTS, rune state), `src/lib/components/`.

## Invariants / gotchas

- **Tutor tools** (`gemini/tools.ts` + `gemini/actions.ts`):
  - Queries return data.
  - UI tools return a `UiBlock` (`card`, `choices`, `links` from the `DESTINATIONS` whitelist, `jptext`).
  - Actions live in the `ACTIONS` registry. `direct` actions run immediately and store an `undo` payload in `tutor_action`. `confirm` actions only store `proposed`; `/api/tutor/actions/[id]` confirms, rejects or undoes them.
  - Outcomes reach the model on its next turn via `pendingReports` (`[Sistema: …]`).
  - Never add global-destructive tools (reset all, import/restore, backups, delete sessions); `tests/tutor-actions.test.ts` guards this.
  - New sensitive actions must be `confirm`.
- Screen context: pages call `setScreenContext` (`client/tutorContext.svelte.ts`). The layout clears it on navigation. The panel (`chat/TutorPanel.svelte`) attaches it as `[Contexto de pantalla: …]` plus a `context` UI chip.
- Sessions are created lazily by `POST /api/chat/start` (first SSE event `{type:'session'}`); `/tutor?nuevo=X` redirects to the draft page `/tutor/nueva?modo=X`. `title_source`: auto | summary | user (user titles are never overwritten). Panel continues the last `origin='panel'` session active < 3 h. New messages reset `summarized`.
- `ChatView.svelte` is shared by `/tutor/[id]`, `/tutor/nueva` and the panel. Any URL with `?tutor=1` opens the panel (also handy for headless screenshots).
- Gemini transient errors (429/500/503): `withRetry` for one-shot calls; the tutor loop retries the stream before any chunk arrives. If a turn still fails, `turnIncomplete` is true and the UI offers «Reintentar» (`{retry:true}` continues the model loop without a new user message). `errorMessage` maps HTTP codes to Spanish messages.
- UI check: Edge headless works on Windows (`msedge --headless=new --user-data-dir=<unique> --window-size=W,H --screenshot=<win path> URL`); width < ~500 px gets clipped, use 500 for mobile. A fresh profile starts at the «descargar diccionario» screen; drive it via DevTools (`--remote-debugging-port`) to click install. Kill headless Edge afterwards or its Web Lock blocks the next run.
- **Tutor history stores raw Gemini parts** (`message.parts`) including `thoughtSignature`; never rewrite them (only `compactParts` merges plain text parts).
- `present_quiz` ends the model turn. Its `functionResponse` is sent with the learner's next input; responses to other calls made in the same turn are held in a hidden `{type:'pending'}` UI block and sent together. Every functionCall must get a response in the next user content.
- Furigana notation in tutor text: `{漢字|かんじ}`; rendered by `client/markdown.ts` (stray `{x}` without pipe is shown as `x`; ordered lists keep numbering across blank lines/sublists — tests in `tests/markdown.test.ts`). Adaptive mode hides it when every kanji in the word has a reading card in Review with stability ≥ 7 days (`readableKanji`).
- Item statuses: none / learning / review / mastered (stability ≥ 21 d), worst facet wins.
- Card keys: kana char, component symbol, kanji char, vocab id (`jm:<id>` from JMdict, `u:<uuid>` user-created).
- Theme: light/dark/system per device (`localStorage['sensei.theme']`, absent = system). `app.html` inline script sets `data-theme` before paint; `client/theme.svelte.ts` cycles it. All colors are CSS vars in `app.css` (light block duplicated for `[data-theme=light]` and `prefers-color-scheme`); don't hardcode colors in components except white text on colored fills.
- Charts follow the dataviz skill via vars: `--series-1` (dark `#3987e5`, light `#2a78d6`) and ordinal `--ord-1..3` + `--ord-N-ink` for learning/review/mastered (dark `#1c5cab/#3987e5/#86b6ef`, light `#86b6ef/#2a78d6/#184f95`).
- Provenance columns: `vocab.glosses_es_source` (jmdict|gemini|user) and `component.name_source` (static|kanji|gemini). Set them whenever writing those fields: export and "reset generated content" depend on them.
- New user tables must be added to `Snapshot` (export/import), `applySnapshot` (replace) and, if they are progress, `reset.ts`. Bump `FORMAT` only for incompatible changes; new snapshot fields are optional (`?`) so older zips still import.
- FSRS scheduler is built per call from settings (`schedulerConfig(db)`: custom params + desired retention), memoized in `fsrs.ts`.
- Review prompt fonts are chosen client-side (`pickFont`, Google Fonts loaded only if `fontVariety`); kana/components/grammar always gothic.
- **Every Gemini call must be tracked**: `generateJson`/`generateText` require `db` + `feature` (key of `FEATURES` in `usage.ts`; keys are stored, don't rename); the tutor stream calls `recordUsage` itself with the last chunk's `usageMetadata`. Failed calls are rows with `ok=false`, cost 0. Unknown model → `cost_usd` null («sin precio»). Deleting a session keeps its usage rows.
- Settings form in /ajustes must not post `goal`/`fsrsParams`/`modelPrices`/`monthlyBudgetUsd`/`budgetHardStop` (they have their own actions; prices, budget and hard stop go through `POST /api/costs`).
- SQLite LIKE treats `_` as wildcard: use `substr(key,1,1) != '_'` for internal settings, not `like '\_%'`.
- **Never `db.get(sql\`…\`)`** with raw SQL: bun-sqlite returns an array of values (`[2600]`), not an object. Use `one<T>(sql\`…\`)` from `#lib/server/db/index.ts` (or `db.all(...)`). Query-builder `.get()` (`db.select()...get()`) is fine.
- The API only exists inside the browser now: test it from page context (DevTools `Runtime.evaluate` → `fetch('/api/…')`), not with curl.
