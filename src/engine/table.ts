// Parametric tables: solve the model once per row with some variables imposed.

import type { Model } from './model';
import { solve, type SolveOptions } from './solver';

export interface TableInput {
  name: string;
  values: number[]; // SI, one per row
}

export interface TableRow {
  ok: boolean;
  values: Record<string, number>; // lower-case var name -> SI value
  error?: string;
}

export function linspace(a: number, b: number, n: number): number[] {
  if (n <= 1) return [a];
  return Array.from({ length: n }, (_, i) => a + ((b - a) * i) / (n - 1));
}

export function runTable(model: Model, inputs: TableInput[], opts: Omit<SolveOptions, 'fixed'> = {}, onRow?: (i: number, row: TableRow) => void): TableRow[] {
  const nRows = Math.max(0, ...inputs.map((c) => c.values.length));
  const idx = inputs.map((c) => {
    const i = model.index.get(c.name.toLowerCase());
    if (i === undefined) throw new Error(`La variable "${c.name}" no aparece en las ecuaciones`);
    return i;
  });
  const rows: TableRow[] = [];
  let guesses = opts.guesses ? new Map(opts.guesses) : new Map<number, number>();
  for (let r = 0; r < nRows; r++) {
    const fixed = new Map<number, number>();
    inputs.forEach((c, k) => {
      const v = c.values[r];
      if (Number.isFinite(v)) fixed.set(idx[k], v);
    });
    const res = solve(model, { ...opts, guesses, fixed });
    const values: Record<string, number> = {};
    model.vars.forEach((v, i) => (values[v.name.toLowerCase()] = res.ok || fixed.has(i) ? res.values[i] : NaN));
    const row: TableRow = { ok: res.ok, values };
    if (!res.ok) row.error = res.diagnostics.filter((d) => d.severity === 'error').map((d) => d.message).join(' ');
    else {
      // continuation: next row starts from this solution
      guesses = new Map(guesses);
      model.vars.forEach((_, i) => guesses.set(i, res.values[i]));
    }
    rows.push(row);
    onRow?.(r, row);
  }
  return rows;
}
