import { translateSource, type Lang } from '../engine';
import { EXAMPLES } from './examples';

export interface TableCol {
  name: string;
  input: boolean;
  from?: number; // in the column's display unit
  to?: number;
}

export interface Doc {
  version: 1;
  /** true once per-variable settings are keyed by the exact (case-sensitive) variable name */
  caseSensitive?: boolean;
  title: string;
  src: string;
  units: Record<string, string>; // var name (case-sensitive) -> display unit
  guesses: Record<string, number>; // SI
  lower: Record<string, number>;
  upper: Record<string, number>;
  table: { columns: TableCol[]; rows: number };
  plot: { x: string; y: string[] };
}

export function docFromExample(id: string, lang: Lang = 'es'): Doc {
  const ex = EXAMPLES.find((e) => e.id === id) ?? EXAMPLES[0];
  return {
    version: 1,
    caseSensitive: true,
    title: ex.title,
    src: translateSource(ex.src, lang),
    units: {},
    guesses: {},
    lower: {},
    upper: {},
    table: ex.table ? { columns: ex.table.columns, rows: ex.table.rows } : { columns: [], rows: 10 },
    plot: { x: ex.table?.x ?? '', y: ex.table?.y ?? [] },
  };
}

const KEY = 'termo-solver:doc';

/**
 * Projects saved before variable names became case-sensitive stored their units,
 * initial guesses and limits under the lower-case name. Re-key each entry to every
 * spelling of that name that appears in the equations, so nothing is lost.
 */
function migrate(d: Doc): Doc {
  if (d.caseSensitive) return d;
  const names = new Set(d.src.match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? []);
  const rekey = <T,>(rec: Record<string, T> | undefined): Record<string, T> => {
    const out: Record<string, T> = {};
    for (const [k, v] of Object.entries(rec ?? {})) {
      let hit = false;
      for (const n of names)
        if (n.toLowerCase() === k.toLowerCase()) {
          out[n] = v;
          hit = true;
        }
      if (!hit) out[k] = v;
    }
    return out;
  };
  return { ...d, caseSensitive: true, units: rekey(d.units), guesses: rekey(d.guesses), lower: rekey(d.lower), upper: rekey(d.upper) };
}

export function loadDoc(): Doc {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const d = JSON.parse(raw);
      if (d && d.version === 1 && typeof d.src === 'string') return migrate({ ...docFromExample('rankine'), caseSensitive: false, ...d });
    }
  } catch {
    /* ignore */
  }
  return docFromExample('rankine');
}

export function saveDoc(d: Doc) {
  try {
    localStorage.setItem(KEY, JSON.stringify(d));
  } catch {
    /* ignore */
  }
}

export function parseDocFile(text: string): Doc {
  const d = JSON.parse(text);
  if (!d || d.version !== 1 || typeof d.src !== 'string') throw new Error('El archivo no es un proyecto válido');
  return migrate({ ...docFromExample('rankine'), caseSensitive: false, ...d });
}

/** True if the text is one of the examples, unedited, in either language. */
export function isExampleSrc(src: string): boolean {
  return EXAMPLES.some((e) => translateSource(e.src, 'es') === src || translateSource(e.src, 'en') === src);
}
