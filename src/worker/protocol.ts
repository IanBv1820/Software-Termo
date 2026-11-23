import type { Diagnostic, Dim, SolveResult, TableInput, TableRow } from '../engine';

export interface VarOut {
  name: string;
  dim: Dim | null;
  guess: number;
  value: number;
  block: number;
}

interface Common {
  id: number;
  src: string;
  guesses?: Record<string, number>;
  lower?: Record<string, number>;
  upper?: Record<string, number>;
}

export type Request =
  | (Common & { type: 'check' })
  | (Common & { type: 'solve' })
  | (Common & { type: 'table'; inputs: TableInput[] });

export type Response =
  | { type: 'ready' }
  | { type: 'fatal'; message: string }
  | { type: 'checked'; id: number; diagnostics: Diagnostic[]; vars: VarOut[] }
  | { type: 'solved'; id: number; ok: boolean; diagnostics: Diagnostic[]; vars: VarOut[]; stats: SolveResult['stats'] | null }
  | { type: 'tableRow'; id: number; index: number; row: TableRow }
  | { type: 'tableDone'; id: number; rows: TableRow[]; diagnostics: Diagnostic[]; vars: VarOut[] };
