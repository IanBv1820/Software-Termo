import { EXAMPLES } from './examples';

export interface TableCol {
  name: string;
  input: boolean;
  from?: number; // in the column's display unit
  to?: number;
}

export interface Doc {
  version: 1;
  title: string;
  src: string;
  units: Record<string, string>; // lower-case var -> display unit
  guesses: Record<string, number>; // SI
  lower: Record<string, number>;
  upper: Record<string, number>;
  table: { columns: TableCol[]; rows: number };
  plot: { x: string; y: string[] };
}

export function docFromExample(id: string): Doc {
  const ex = EXAMPLES.find((e) => e.id === id) ?? EXAMPLES[0];
  return {
    version: 1,
    title: ex.title,
    src: ex.src,
    units: {},
    guesses: {},
    lower: {},
    upper: {},
    table: ex.table ? { columns: ex.table.columns, rows: ex.table.rows } : { columns: [], rows: 10 },
    plot: { x: ex.table?.x ?? '', y: ex.table?.y ?? [] },
  };
}

const KEY = 'termo-solver:doc';

export function loadDoc(): Doc {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const d = JSON.parse(raw);
      if (d && d.version === 1 && typeof d.src === 'string') return { ...docFromExample('rankine'), ...d };
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
  return { ...docFromExample('rankine'), ...d };
}
