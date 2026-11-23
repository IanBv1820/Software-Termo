// Equation solver: structural analysis (matching + block decomposition)
// followed by damped Newton on each block, in the spirit of EES.

import type { Diagnostic, Model } from './model';
import { PropertyError } from './properties';

export interface SolveOptions {
  /** initial guesses (SI) by variable index; missing → automatic guess */
  guesses?: Map<number, number>;
  lower?: Map<number, number>;
  upper?: Map<number, number>;
  /** variables whose value is imposed from outside (parametric tables) */
  fixed?: Map<number, number>;
  maxIter?: number;
  tol?: number;
}

export interface SolveResult {
  ok: boolean;
  values: Float64Array;
  diagnostics: Diagnostic[];
  stats: { equations: number; unknowns: number; blocks: number; largestBlock: number; iterations: number; maxResidual: number; ms: number };
  /** variable index -> block number in solution order (for display) */
  block: Int32Array;
}

class SolveFailure extends Error {
  constructor(
    message: string,
    public eq?: number,
  ) {
    super(message);
  }
}

export function solve(model: Model, opts: SolveOptions = {}): SolveResult {
  const t0 = performance.now();
  const nv = model.vars.length;
  const fixed = opts.fixed ?? new Map<number, number>();
  const diagnostics: Diagnostic[] = [];
  const x = new Float64Array(nv);
  model.vars.forEach((v, i) => (x[i] = opts.guesses?.get(i) ?? v.guess));
  for (const [i, v] of fixed) x[i] = v;
  const block = new Int32Array(nv).fill(-1);
  const stats = { equations: 0, unknowns: 0, blocks: 0, largestBlock: 0, iterations: 0, maxResidual: 0, ms: 0 };
  const done = (ok: boolean): SolveResult => {
    stats.ms = performance.now() - t0;
    return { ok, values: x, diagnostics, stats, block };
  };

  // Equations that only set a fixed variable to a constant are replaced by the fixed value.
  const eqIdx: number[] = [];
  model.eqs.forEach((e, i) => {
    if (e.fixes !== undefined && fixed.has(e.fixes)) return;
    eqIdx.push(i);
  });
  const unknowns: number[] = [];
  for (let i = 0; i < nv; i++) if (!fixed.has(i)) unknowns.push(i);
  stats.equations = eqIdx.length;
  stats.unknowns = unknowns.length;

  // ---- structure: maximum matching equations <-> unknowns ----
  const uPos = new Map<number, number>();
  unknowns.forEach((v, k) => uPos.set(v, k));
  const adj: number[][] = eqIdx.map((ei) => model.eqs[ei].vars.filter((v) => uPos.has(v)).map((v) => uPos.get(v)!));
  const matchEq = new Int32Array(eqIdx.length).fill(-1); // eq -> unknown
  const matchVar = new Int32Array(unknowns.length).fill(-1); // unknown -> eq
  for (let e = 0; e < adj.length; e++) {
    const seen = new Uint8Array(unknowns.length);
    const tryEq = (q: number): boolean => {
      for (const u of adj[q]) {
        if (seen[u]) continue;
        seen[u] = 1;
        if (matchVar[u] < 0 || tryEq(matchVar[u])) {
          matchVar[u] = q;
          matchEq[q] = u;
          return true;
        }
      }
      return false;
    };
    tryEq(e);
  }

  const unmatchedEqs = [...matchEq.keys()].filter((e) => matchEq[e] < 0);
  const unmatchedVars = [...matchVar.keys()].filter((u) => matchVar[u] < 0);
  if (unmatchedEqs.length || unmatchedVars.length) {
    const ne = eqIdx.length;
    const nu = unknowns.length;
    const names = (us: number[]) => us.map((u) => model.vars[unknowns[u]].name).join(', ');
    if (ne < nu || (unmatchedVars.length && !unmatchedEqs.length)) {
      diagnostics.push({
        severity: 'error',
        message:
          (ne < nu ? `Hay ${ne} ecuaciones y ${nu} incógnitas: faltan ${nu - ne} ecuación(es). ` : 'Las ecuaciones no alcanzan para todas las variables. ') +
          `No se pueden determinar: ${names(unmatchedVars)}. Dales un valor o agrega ecuaciones que las relacionen.`,
      });
    } else if (ne > nu || (unmatchedEqs.length && !unmatchedVars.length)) {
      const fixedNames = [...fixed.keys()].map((i) => model.vars[i].name);
      for (const e of unmatchedEqs) {
        const me = model.eqs[eqIdx[e]];
        diagnostics.push({
          severity: 'error',
          message:
            (ne > nu ? `Hay ${ne} ecuaciones y solo ${nu} incógnitas: sobran ${ne - nu}. ` : 'Ecuación de más: ') +
            `Esta ecuación no tiene incógnita propia (sobra o repite información)` +
            (fixedNames.length ? `. Si la tabla fija ${fixedNames.join(', ')}, quita esa variable de aquí.` : '.'),
          pos: me.eq.pos,
          eq: eqIdx[e],
        });
      }
    } else {
      diagnostics.push({
        severity: 'error',
        message: `El número de ecuaciones e incógnitas coincide (${ne}), pero algunas ecuaciones repiten información y ${names(unmatchedVars)} queda(n) sin determinar.`,
      });
      for (const e of unmatchedEqs)
        diagnostics.push({ severity: 'error', message: 'Esta ecuación no aporta información nueva.', pos: model.eqs[eqIdx[e]].eq.pos, eq: eqIdx[e] });
    }
    return done(false);
  }

  // ---- block decomposition (Tarjan SCC on equation dependency graph) ----
  // eq a depends on eq b if a uses the unknown matched to b.
  const n = eqIdx.length;
  const deps: number[][] = adj.map((us, q) => us.filter((u) => matchVar[u] !== q).map((u) => matchVar[u]));
  const blocks: number[][] = [];
  {
    const idx = new Int32Array(n).fill(-1);
    const low = new Int32Array(n);
    const onStack = new Uint8Array(n);
    const stack: number[] = [];
    let counter = 0;
    // iterative Tarjan to avoid recursion limits on big models
    for (let s = 0; s < n; s++) {
      if (idx[s] >= 0) continue;
      const work: Array<[number, number]> = [[s, 0]];
      while (work.length) {
        const top = work[work.length - 1];
        const [v, i] = top;
        if (i === 0) {
          idx[v] = low[v] = counter++;
          stack.push(v);
          onStack[v] = 1;
        }
        if (i < deps[v].length) {
          top[1]++;
          const w = deps[v][i];
          if (idx[w] < 0) work.push([w, 0]);
          else if (onStack[w]) low[v] = Math.min(low[v], idx[w]);
          continue;
        }
        if (low[v] === idx[v]) {
          const comp: number[] = [];
          let w: number;
          do {
            w = stack.pop()!;
            onStack[w] = 0;
            comp.push(w);
          } while (w !== v);
          blocks.push(comp);
        }
        work.pop();
        if (work.length) {
          const u = work[work.length - 1][0];
          low[u] = Math.min(low[u], low[v]);
        }
      }
    }
  }
  stats.blocks = blocks.length;

  const lower = (v: number) => opts.lower?.get(v) ?? -Infinity;
  const upper = (v: number) => opts.upper?.get(v) ?? Infinity;
  const tol = opts.tol ?? 1e-9;
  const maxIter = opts.maxIter ?? 200;

  // ---- solve blocks in order ----
  try {
    blocks.forEach((comp, b) => {
      const eqs = comp.map((q) => eqIdx[q]);
      const vs = comp.map((q) => unknowns[matchEq[q]]);
      vs.forEach((v) => (block[v] = b));
      stats.largestBlock = Math.max(stats.largestBlock, vs.length);
      if (vs.length === 1) {
        const me = model.eqs[eqs[0]];
        const ex = me.explicit?.find((e) => e.v === vs[0]);
        if (ex) {
          let val: number;
          try {
            val = ex.expr(x);
          } catch (e) {
            throw new SolveFailure(errMsg(e), eqs[0]);
          }
          if (!Number.isFinite(val)) throw new SolveFailure(`No se pudo calcular ${model.vars[vs[0]].name}: el resultado no es un número finito (¿división entre cero o raíz de negativo?).`, eqs[0]);
          x[vs[0]] = val;
          return;
        }
      }
      stats.iterations += solveBlockRobust(model, eqs, vs, x, lower, upper, tol, maxIter);
    });
  } catch (e) {
    if (e instanceof SolveFailure) {
      diagnostics.push({ severity: 'error', message: e.message, eq: e.eq, pos: e.eq !== undefined ? model.eqs[e.eq].eq.pos : undefined });
      return done(false);
    }
    throw e;
  }

  // ---- final residual check (also equations with no unknowns) ----
  let worst = 0;
  for (const i of eqIdx) {
    const me = model.eqs[i];
    let l: number, r: number;
    try {
      l = me.lhs(x);
      r = me.rhs(x);
    } catch (e) {
      diagnostics.push({ severity: 'error', message: errMsg(e), eq: i, pos: me.eq.pos });
      return done(false);
    }
    const rel = Math.abs(l - r) / Math.max(Math.abs(l), Math.abs(r), 1e-12);
    const absSmall = Math.abs(l - r) < 1e-12;
    const res = absSmall ? 0 : rel;
    worst = Math.max(worst, res);
    if (res > 1e-6) diagnostics.push({ severity: 'warning', message: `Esta ecuación no se cumple bien (residuo relativo ${res.toExponential(2)}).`, eq: i, pos: me.eq.pos });
  }
  stats.maxResidual = worst;
  stats.ms = performance.now() - t0;
  return done(true);
}

/**
 * Newton from the given start; if it fails, retry from perturbed starts, and for
 * single-variable blocks fall back to a bracketing search (sign change + bisection).
 */
function solveBlockRobust(
  model: Model,
  eqs: number[],
  vs: number[],
  x: Float64Array,
  lower: (v: number) => number,
  upper: (v: number) => number,
  tol: number,
  maxIter: number,
): number {
  const x0 = vs.map((v) => x[v]);
  let firstErr: SolveFailure | null = null;
  const starts: ((k: number, v: number) => number)[] = [
    (_k, v) => v,
    (k, v) => (v === 0 ? 0.1 * (k + 1) : v * (1 + 0.13 * (k + 1))),
    (_k, v) => (v === 0 ? 1 : v * 2),
    (_k, v) => v * 0.5,
    (k, v) => (v === 0 ? -0.1 * (k + 1) : v * (1 - 0.07 * (k + 1))),
    (_k, v) => (v === 0 ? 10 : v * 10),
    (_k, v) => v * 0.1,
    (_k, v) => -v,
  ];
  let iters = 0;
  for (const st of starts) {
    vs.forEach((v, k) => (x[v] = st(k, x0[k])));
    try {
      return iters + newtonBlock(model, eqs, vs, x, lower, upper, tol, maxIter);
    } catch (e) {
      if (!(e instanceof SolveFailure)) throw e;
      firstErr ??= e;
      iters += 1;
    }
    if (vs.length === 1) {
      vs.forEach((v, k) => (x[v] = x0[k]));
      if (bracketScalar(model, eqs[0], vs[0], x, lower(vs[0]), upper(vs[0]))) return iters;
      break;
    }
  }
  vs.forEach((v, k) => (x[v] = x0[k]));
  throw firstErr!;
}

/** Scalar fallback: march away from the guess looking for a sign change, then bisect. */
function bracketScalar(model: Model, eq: number, v: number, x: Float64Array, lo: number, hi: number): boolean {
  const me = model.eqs[eq];
  const f = (t: number) => {
    x[v] = t;
    try {
      const l = me.lhs(x);
      const r = me.rhs(x);
      const d = l - r;
      return Number.isFinite(d) ? { d, mag: Math.max(Math.abs(l), Math.abs(r)) } : null;
    } catch {
      return null;
    }
  };
  const x0 = x[v];
  const base = Math.max(Math.abs(x0), 1);
  for (const dir of [1, -1]) {
    let a = x0;
    let fa = f(a);
    for (let k = 0; k < 220; k++) {
      const b = Math.min(hi, Math.max(lo, x0 + dir * base * 1e-3 * Math.pow(1.12, k)));
      const fb = f(b);
      if (fb && fa && Math.sign(fb.d) !== Math.sign(fa.d)) {
        // bisection
        let lo2 = a,
          hi2 = b,
          flo = fa.d;
        for (let it = 0; it < 200; it++) {
          const m = 0.5 * (lo2 + hi2);
          const fm = f(m);
          if (!fm) break;
          if (Math.abs(fm.d) <= 1e-12 * Math.max(fm.mag, 1e-12) || Math.abs(hi2 - lo2) < 1e-15 * Math.max(Math.abs(m), 1e-30)) {
            if (Math.abs(fm.d) <= 1e-6 * Math.max(fm.mag, 1e-12)) return true; // real root (not a pole)
            break;
          }
          if (Math.sign(fm.d) === Math.sign(flo)) {
            lo2 = m;
            flo = fm.d;
          } else hi2 = m;
        }
      }
      if (b === lo || b === hi) break;
      a = b;
      fa = fb;
    }
  }
  x[v] = x0;
  return false;
}

function errMsg(e: unknown): string {
  if (e instanceof PropertyError) return `Propiedad fuera de rango: ${e.message}`;
  if (e instanceof Error) return e.message;
  return String(e);
}

/** Damped Newton with numerical Jacobian; falls back to Levenberg–Marquardt steps. Returns iterations used. */
function newtonBlock(
  model: Model,
  eqs: number[],
  vs: number[],
  x: Float64Array,
  lower: (v: number) => number,
  upper: (v: number) => number,
  tol: number,
  maxIter: number,
): number {
  const n = vs.length;
  let lastErr = '';
  let lastErrEq: number | undefined;
  const scale = new Float64Array(n).fill(1);

  // residuals; returns false if any equation can't be evaluated
  const F = (out: Float64Array, mags?: Float64Array): boolean => {
    for (let k = 0; k < n; k++) {
      const me = model.eqs[eqs[k]];
      let l: number, r: number;
      try {
        l = me.lhs(x);
        r = me.rhs(x);
      } catch (e) {
        lastErr = errMsg(e);
        lastErrEq = eqs[k];
        return false;
      }
      out[k] = l - r;
      if (mags) mags[k] = Math.max(Math.abs(l), Math.abs(r));
      if (!Number.isFinite(out[k])) {
        lastErr = 'Resultado no finito (¿división entre cero, raíz o logaritmo de un negativo?)';
        lastErrEq = eqs[k];
        return false;
      }
    }
    return true;
  };
  const clamp = (k: number, v: number) => Math.min(upper(vs[k]), Math.max(lower(vs[k]), v));
  const norm = (r: Float64Array) => {
    let s = 0;
    for (let k = 0; k < n; k++) s += (r[k] / scale[k]) ** 2;
    return Math.sqrt(s);
  };

  const r = new Float64Array(n);
  const mags = new Float64Array(n);
  const x0 = vs.map((v) => x[v]);

  // find a starting point where everything evaluates
  const factors = [1, 0.5, 2, 0.1, 10, 1.5, 0.75];
  let okStart = false;
  for (const f of factors) {
    vs.forEach((v, k) => (x[v] = clamp(k, x0[k] === 0 ? f - 1 : x0[k] * f)));
    if (F(r, mags)) {
      okStart = true;
      break;
    }
  }
  if (!okStart) {
    const names = vs.map((v) => model.vars[v].name).join(', ');
    throw new SolveFailure(`${lastErr}. No se pudo evaluar con los valores iniciales de ${names}; prueba dar valores iniciales más realistas en la tabla de variables.`, lastErrEq);
  }
  for (let k = 0; k < n; k++) scale[k] = mags[k] > 0 ? mags[k] : 1;

  const J = new Float64Array(n * n);
  const rt = new Float64Array(n);
  const dx = new Float64Array(n);
  const xs = new Float64Array(n);
  let lambda = 0;
  for (let it = 1; it <= maxIter; it++) {
    // convergence test: every residual small relative to its terms
    if (!F(r, mags)) throw new SolveFailure(lastErr, lastErrEq);
    let conv = true;
    for (let k = 0; k < n; k++) if (Math.abs(r[k]) > tol * Math.max(mags[k], 1e-12) && Math.abs(r[k]) > 1e-14) conv = false;
    if (conv) return it - 1;

    // Jacobian
    for (let j = 0; j < n; j++) {
      const v = vs[j];
      const xj = x[v];
      const h = 1e-7 * Math.max(Math.abs(xj), 1e-6 * Math.max(Math.abs(x0[j]), 1), 1e-8);
      x[v] = xj + h;
      let ok = F(rt);
      if (!ok) {
        x[v] = xj - h;
        ok = F(rt);
        if (!ok) {
          x[v] = xj;
          throw new SolveFailure(lastErr, lastErrEq);
        }
        for (let k = 0; k < n; k++) J[k * n + j] = (r[k] - rt[k]) / h;
      } else {
        for (let k = 0; k < n; k++) J[k * n + j] = (rt[k] - r[k]) / h;
      }
      x[v] = xj;
    }

    for (let k = 0; k < n; k++) xs[k] = x[vs[k]];
    const f0 = norm(r);
    let accepted = false;
    // try Newton first, then increasingly damped LM steps
    for (let attempt = 0; attempt < 8 && !accepted; attempt++) {
      const ok = attempt === 0 && lambda === 0 ? luSolve(J, r, dx, n) : lmSolve(J, r, dx, n, scale, (lambda = lambda ? lambda * 10 : 1e-3));
      if (!ok) {
        if (lambda === 0) lambda = 1e-3;
        continue;
      }
      let alpha = 1;
      while (alpha > 1e-4) {
        for (let k = 0; k < n; k++) x[vs[k]] = clamp(k, xs[k] - alpha * dx[k]);
        if (F(rt) && norm(rt) < (1 - 1e-4 * alpha) * f0) {
          accepted = true;
          break;
        }
        alpha /= 2;
      }
      if (!accepted) for (let k = 0; k < n; k++) x[vs[k]] = xs[k];
    }
    if (accepted) lambda = lambda / 10 < 1e-6 ? 0 : lambda / 10;
    else {
      // can't decrease residual: check if we are already "good enough"
      let maxRel = 0;
      for (let k = 0; k < n; k++) maxRel = Math.max(maxRel, Math.abs(r[k]) / Math.max(mags[k], 1e-12));
      if (maxRel < 1e-6) return it;
      const names = vs.map((v) => model.vars[v].name).join(', ');
      throw new SolveFailure(
        `No se encontró solución para ${names}${n > 1 ? ' (sistema acoplado)' : ''}. Prueba otros valores iniciales o límites en la tabla de variables.`,
        eqs[0],
      );
    }
  }
  throw new SolveFailure(`No convergió en ${maxIter} iteraciones. Prueba otros valores iniciales.`, eqs[0]);
}

/** Solve J dx = r by LU with partial pivoting. Returns false if singular. */
function luSolve(Jin: Float64Array, b: Float64Array, out: Float64Array, n: number): boolean {
  const A = Float64Array.from(Jin);
  const y = Float64Array.from(b);
  for (let c = 0; c < n; c++) {
    let p = c;
    let best = Math.abs(A[c * n + c]);
    for (let r = c + 1; r < n; r++) if (Math.abs(A[r * n + c]) > best) (best = Math.abs(A[r * n + c])), (p = r);
    // relative singularity test against the row scale
    let rowMax = 0;
    for (let j = 0; j < n; j++) rowMax = Math.max(rowMax, Math.abs(A[p * n + j]));
    if (best === 0 || best < 1e-14 * rowMax) return false;
    if (p !== c) {
      for (let j = 0; j < n; j++) [A[c * n + j], A[p * n + j]] = [A[p * n + j], A[c * n + j]];
      [y[c], y[p]] = [y[p], y[c]];
    }
    for (let r = c + 1; r < n; r++) {
      const f = A[r * n + c] / A[c * n + c];
      if (f === 0) continue;
      for (let j = c; j < n; j++) A[r * n + j] -= f * A[c * n + j];
      y[r] -= f * y[c];
    }
  }
  for (let r = n - 1; r >= 0; r--) {
    let s = y[r];
    for (let j = r + 1; j < n; j++) s -= A[r * n + j] * out[j];
    out[r] = s / A[r * n + r];
  }
  return out.every(Number.isFinite);
}

/** Levenberg–Marquardt step on the scaled system: (JᵀJ + λ diag(JᵀJ)) dx = Jᵀ r */
function lmSolve(J: Float64Array, r: Float64Array, out: Float64Array, n: number, scale: Float64Array, lambda: number): boolean {
  const Js = new Float64Array(n * n);
  const rs = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    rs[k] = r[k] / scale[k];
    for (let j = 0; j < n; j++) Js[k * n + j] = J[k * n + j] / scale[k];
  }
  const A = new Float64Array(n * n);
  const g = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      let s = 0;
      for (let k = 0; k < n; k++) s += Js[k * n + i] * Js[k * n + j];
      A[i * n + j] = s;
    }
    let s = 0;
    for (let k = 0; k < n; k++) s += Js[k * n + i] * rs[k];
    g[i] = s;
  }
  for (let i = 0; i < n; i++) A[i * n + i] += lambda * (A[i * n + i] || 1);
  return luSolve(A, g, out, n);
}
