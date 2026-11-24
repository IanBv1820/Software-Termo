import type { Lang } from '../engine';
import type { UnitSystem } from './format';

export type Theme = 'auto' | 'light' | 'dark';

export interface Prefs {
  lang: Lang; // language of function and fluid names written by the app
  units: UnitSystem; // default display units
  theme: Theme;
}

const KEY = 'software-termo:prefs';
export const DEFAULT_PREFS: Prefs = { lang: 'es', units: 'metric', theme: 'auto' };

export function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(KEY);
    const old = localStorage.getItem('termo-solver:theme');
    const p = raw ? JSON.parse(raw) : {};
    return { ...DEFAULT_PREFS, ...(old ? { theme: old as Theme } : {}), ...p };
  } catch {
    return DEFAULT_PREFS;
  }
}

export function savePrefs(p: Prefs) {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* ignore */
  }
}
