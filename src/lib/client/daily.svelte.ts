// Sesión diaria en curso (/hoy): qué pasos tiene, cuáles están hechos. Por dispositivo y por día (localStorage):
// al día siguiente se descarta sola. Las páginas avisan al terminar su parte con `completeDaily(id)`.
import { goto } from './nav.ts';

export type DailyStepId = 'review' | 'lesson' | 'reading' | 'close';
export type DailyStatus = 'todo' | 'done' | 'skipped';
export type ActiveStep = { id: DailyStepId; title: string; href: string; minutes: number; status: DailyStatus };
type Active = { day: string; budget: number; steps: ActiveStep[] };

const KEY = 'sensei.daily';
const today = () => new Date().toDateString();

function load(): Active | null {
	try {
		const a = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Active | null;
		return a && a.day === today() ? a : null;
	} catch {
		return null;
	}
}

export const daily = $state<{ active: Active | null }>({ active: null });

function persist() {
	try {
		if (daily.active) localStorage.setItem(KEY, JSON.stringify(daily.active));
		else localStorage.removeItem(KEY);
	} catch {
		/* sin almacenamiento: dura lo que la pestaña */
	}
}

export function initDaily() {
	if (typeof localStorage !== 'undefined') daily.active = load();
}

/** Paso en curso: el primero sin hacer ni saltar. */
export function currentStep() {
	return daily.active?.steps.find((s) => s.status === 'todo') ?? null;
}

export function dailyDone() {
	return !!daily.active && !currentStep();
}

export function startDaily(budget: number, steps: { id: DailyStepId; title: string; href: string; minutes: number }[]) {
	daily.active = { day: today(), budget, steps: steps.map((s) => ({ ...s, status: 'todo' })) };
	persist();
	const first = currentStep();
	if (first) void goto(first.href);
}

/** Una página terminó su parte (p. ej. el repaso). No navega: la barra ofrece «Siguiente». */
export function completeDaily(id: DailyStepId) {
	const a = daily.active;
	if (!a || a.day !== today()) return;
	const s = a.steps.find((x) => x.id === id && x.status === 'todo');
	if (!s) return;
	s.status = 'done';
	persist();
}

export function skipDaily() {
	const s = currentStep();
	if (!s) return;
	s.status = 'skipped';
	persist();
	goNext();
}

export function goNext() {
	const s = currentStep();
	void goto(s ? s.href : '/hoy');
}

export function endDaily() {
	daily.active = null;
	persist();
}
