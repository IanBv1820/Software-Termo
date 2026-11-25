// Turns parsed equations into a model: variables, compiled residual functions,
// and the result of the unit (dimension) check.

import { parse, ParseErrors, type Equation, type Expr, type Pos } from './parser';
import {
  evalProp,
  HA_FUNCS,
  HA_INPUTS,
  HUMID_AIR_NAMES,
  INPUTS,
  PROP_FUNCS,
  PropertyError,
  type PropsBackend,
  canonFunc,
  canonInput,
} from './properties';
import { D, DIMLESS, dimEq, isDimless, siString, type Dim } from './units';

export interface Diagnostic {
  severity: 'error' | 'warning' | 'info';
  message: string;
  pos?: Pos;
  eq?: number;
}

type Fn = (x: Float64Array) => number;

export interface ModelEq {
  eq: Equation;
  lhs: Fn;
  rhs: Fn;
  vars: number[]; // variable indices used
  /** if the equation is `v = <expr without v>` (or mirrored), v's index and which side is the expression */
  explicit?: { v: number; expr: Fn }[];
  /** true when one side is a single variable and the other contains no variables at all (e.g. T1 = 25 [C]) */
  fixes?: number;
}

export interface VarInfo {
  name: string; // display name (first spelling seen)
  dim: Dim | null; // null = could not be determined
  guess: number; // automatic initial guess (SI)
}

export interface Model {
  eqs: ModelEq[];
  vars: VarInfo[];
  index: Map<string, number>; // lower-case name -> index
  diagnostics: Diagnostic[];
}

const BUILTINS: Record<string, { n: number | 'var'; f: (...a: number[]) => number; dims: 'dimless' | 'same' | 'sqrt' }> = {
  sqrt: { n: 1, f: Math.sqrt, dims: 'sqrt' },
  exp: { n: 1, f: Math.exp, dims: 'dimless' },
  ln: { n: 1, f: Math.log, dims: 'dimless' },
  log: { n: 1, f: Math.log, dims: 'dimless' },
  log10: { n: 1, f: Math.log10, dims: 'dimless' },
  sin: { n: 1, f: Math.sin, dims: 'dimless' },
  cos: { n: 1, f: Math.cos, dims: 'dimless' },
  tan: { n: 1, f: Math.tan, dims: 'dimless' },
  asin: { n: 1, f: Math.asin, dims: 'dimless' },
  arcsin: { n: 1, f: Math.asin, dims: 'dimless' },
  acos: { n: 1, f: Math.acos, dims: 'dimless' },
  arccos: { n: 1, f: Math.acos, dims: 'dimless' },
  atan: { n: 1, f: Math.atan, dims: 'dimless' },
  arctan: { n: 1, f: Math.atan, dims: 'dimless' },
  sinh: { n: 1, f: Math.sinh, dims: 'dimless' },
  cosh: { n: 1, f: Math.cosh, dims: 'dimless' },
  tanh: { n: 1, f: Math.tanh, dims: 'dimless' },
  abs: { n: 1, f: Math.abs, dims: 'same' },
  min: { n: 'var', f: Math.min, dims: 'same' },
  max: { n: 'var', f: Math.max, dims: 'same' },
};
const CONSTANTS: Record<string, { value: number; dim: Dim }> = {
  pi: { value: Math.PI, dim: DIMLESS },
};

export class ModelError extends Error {
  constructor(public diagnostics: Diagnostic[]) {
    super(diagnostics.map((d) => d.message).join('\n'));
  }
}

/** Parse + compile. Throws ModelError on syntax/semantic errors. Unit problems are returned as diagnostics. */
export function buildModel(src: string, backend: PropsBackend | null): Model {
  let eqs: Equation[];
  try {
    eqs = parse(src);
  } catch (e) {
    if (e instanceof ParseErrors) {
      throw new ModelError(e.errors.map((pe) => ({ severity: 'error', message: pe.message, pos: pe.pos })));
    }
    throw e;
  }

  const index = new Map<string, number>();
  const vars: VarInfo[] = [];
  const errors: Diagnostic[] = [];
  const roleGuess = new Map<number, number>();

  const varIdx = (name: string): number => {
    const k = name.toLowerCase();
    let i = index.get(k);
    if (i === undefined) {
      i = vars.length;
      index.set(k, i);
      vars.push({ name, dim: null, guess: 1 });
    }
    return i;
  };

  // ---------- compile ----------
  function compile(e: Expr, used: Set<number>, eqI: number): Fn {
    switch (e.kind) {
      case 'num': {
        const v = e.value;
        return () => v;
      }
      case 'str':
        errors.push({ severity: 'error', message: `El texto '${e.value}' solo puede usarse como nombre de fluido`, pos: e.pos, eq: eqI });
        return () => NaN;
      case 'var': {
        const c = CONSTANTS[e.name.toLowerCase()];
        if (c && !index.has(e.name.toLowerCase())) {
          const v = c.value;
          return () => v;
        }
        const i = varIdx(e.name);
        used.add(i);
        return (x) => x[i];
      }
      case 'neg': {
        const a = compile(e.arg, used, eqI);
        return (x) => -a(x);
      }
      case 'bin': {
        const a = compile(e.a, used, eqI);
        const b = compile(e.b, used, eqI);
        switch (e.op) {
          case '+':
            return (x) => a(x) + b(x);
          case '-':
            return (x) => a(x) - b(x);
          case '*':
            return (x) => a(x) * b(x);
          case '/':
            return (x) => a(x) / b(x);
          case '^':
            return (x) => Math.pow(a(x), b(x));
        }
        break;
      }
      case 'call':
        return compileCall(e, used, eqI);
    }
    throw new Error('unreachable');
  }

  function compileCall(e: Extract<Expr, { kind: 'call' }>, used: Set<number>, eqI: number): Fn {
    const name = canonFunc(e.name);
    const b = BUILTINS[name];
    if (b) {
      if (e.args.some((a) => a.key)) {
        errors.push({ severity: 'error', message: `${e.name}() no acepta argumentos con nombre`, pos: e.pos, eq: eqI });
        return () => NaN;
      }
      if (b.n !== 'var' && e.args.length !== b.n) {
        errors.push({ severity: 'error', message: `${e.name}() necesita ${b.n} argumento(s)`, pos: e.pos, eq: eqI });
        return () => NaN;
      }
      if (b.n === 'var' && e.args.length < 1) {
        errors.push({ severity: 'error', message: `${e.name}() necesita al menos un argumento`, pos: e.pos, eq: eqI });
        return () => NaN;
      }
      const args = e.args.map((a) => compile(a.value, used, eqI));
      const f = b.f;
      if (args.length === 1) {
        const a0 = args[0];
        return (x) => f(a0(x));
      }
      return (x) => f(...args.map((a) => a(x)));
    }

    const isHA = name in HA_FUNCS;
    const pf = PROP_FUNCS[name];
    if (!isHA && !pf) {
      errors.push({
        severity: 'error',
        message: `Función desconocida "${e.name}". Revisa la pestaña Ayuda para ver las funciones disponibles.`,
        pos: e.pos,
        eq: eqI,
      });
      return () => NaN;
    }
    const [first, ...rest] = e.args;
    if (!first || first.key || (first.value.kind !== 'var' && first.value.kind !== 'str')) {
      errors.push({
        severity: 'error',
        message: `${e.name}(): el primer argumento debe ser el fluido, por ejemplo ${e.name}(Water, ...)`,
        pos: e.pos,
        eq: eqI,
      });
      return () => NaN;
    }
    const fluid = first.value.kind === 'var' ? first.value.name : first.value.value;
    if (isHA && !HUMID_AIR_NAMES.has(fluid.toLowerCase())) {
      errors.push({ severity: 'error', message: `${e.name}() es para aire húmedo: usa ${e.name}(AirH2O, T=..., P=..., R=...)`, pos: e.pos, eq: eqI });
      return () => NaN;
    }
    if (!isHA && HUMID_AIR_NAMES.has(fluid.toLowerCase())) {
      errors.push({
        severity: 'error',
        message: `Para aire húmedo usa HumRat, RelHum, WetBulb, DewPoint o Enthalpy_HA, por ejemplo HumRat(AirH2O, T=T1, P=P1, R=0.5)`,
        pos: e.pos,
        eq: eqI,
      });
      return () => NaN;
    }
    const table = isHA ? HA_INPUTS : INPUTS;
    const need = isHA ? 3 : pf.nInputs;
    const keys: string[] = [];
    const fns: Fn[] = [];
    for (const a of rest) {
      const key = a.key ? canonInput(a.key, isHA) : undefined;
      if (!key || !(key in table)) {
        const valid = Object.keys(table).join(', ');
        errors.push({
          severity: 'error',
          message: a.key
            ? `${e.name}(): "${a.key}" no es una entrada válida. Usa: ${valid}`
            : `${e.name}(): escribe las entradas con nombre, por ejemplo T=T1, P=P1 (válidas: ${valid})`,
          pos: a.value.pos,
          eq: eqI,
        });
        return () => NaN;
      }
      if (keys.some((k) => table[k].cp === table[key].cp)) {
        errors.push({ severity: 'error', message: `${e.name}(): la entrada ${a.key} está repetida`, pos: a.value.pos, eq: eqI });
        return () => NaN;
      }
      keys.push(key);
      fns.push(compile(a.value, used, eqI));
      if (a.value.kind === 'var' && !CONSTANTS[a.value.name.toLowerCase()]) {
        const g = ROLE_GUESS[key];
        if (g !== undefined) roleGuess.set(varIdx(a.value.name), g);
      }
    }
    if (keys.length !== need) {
      const hint = need === 0 ? `${e.name}(${fluid})` : need === 1 ? `${e.name}(${fluid}, ${pf.out === 'T' ? 'P' : 'T'}=...)` : `${e.name}(${fluid}, T=..., P=...)`;
      errors.push({
        severity: 'error',
        message: `${e.name}() necesita ${need} entrada(s) además del fluido, por ejemplo ${hint}`,
        pos: e.pos,
        eq: eqI,
      });
      return () => NaN;
    }
    const be = backend;
    return (x) => {
      if (!be) throw new PropertyError('Las propiedades termodinámicas aún se están cargando');
      return evalProp(
        be,
        name,
        fluid,
        keys.map((k, j) => [k, fns[j](x)]),
      );
    };
  }

  const modelEqs: ModelEq[] = eqs.map((eq, i) => {
    const used = new Set<number>();
    const lhs = compile(eq.lhs, used, i);
    const rhs = compile(eq.rhs, used, i);
    const me: ModelEq = { eq, lhs, rhs, vars: [...used] };
    // explicit forms
    const explicit: { v: number; expr: Fn }[] = [];
    const sides: [Expr, Expr, Fn][] = [
      [eq.lhs, eq.rhs, rhs],
      [eq.rhs, eq.lhs, lhs],
    ];
    for (const [side, other, otherFn] of sides) {
      if (side.kind === 'var' && index.has(side.name.toLowerCase())) {
        const v = index.get(side.name.toLowerCase())!;
        if (!containsVar(other, side.name.toLowerCase())) explicit.push({ v, expr: otherFn });
        if (!hasAnyVar(other)) me.fixes = v;
      }
    }
    if (explicit.length) me.explicit = explicit;
    return me;
  });

  if (errors.length) throw new ModelError(errors);

  const model: Model = { eqs: modelEqs, vars, index, diagnostics: [] };
  checkUnits(model);
  // initial guesses: by role in property calls, then by dimension
  vars.forEach((v, i) => {
    const r = roleGuess.get(i);
    if (r !== undefined) v.guess = r;
    else if (v.dim && dimEq(v.dim, D.temperature)) v.guess = 300;
    else if (v.dim && dimEq(v.dim, D.pressure)) v.guess = 1e5;
    else if (v.dim && dimEq(v.dim, D.specEnergy)) v.guess = 1e5;
    else if (v.dim && dimEq(v.dim, D.specEntropy)) v.guess = 1000;
  });
  return model;
}

const ROLE_GUESS: Record<string, number> = { t: 300, p: 1e5, x: 0.5, q: 0.5, r: 0.5, b: 290, h: 3e5, s: 1500, d: 1, rho: 1, v: 1 };

function containsVar(e: Expr, lname: string): boolean {
  switch (e.kind) {
    case 'var':
      return e.name.toLowerCase() === lname;
    case 'neg':
      return containsVar(e.arg, lname);
    case 'bin':
      return containsVar(e.a, lname) || containsVar(e.b, lname);
    case 'call':
      return e.args.some((a, i) => !(i === 0 && isFluidArg(e) ) && containsVar(a.value, lname));
    default:
      return false;
  }
}
function hasAnyVar(e: Expr): boolean {
  switch (e.kind) {
    case 'var':
      return !CONSTANTS[e.name.toLowerCase()];
    case 'neg':
      return hasAnyVar(e.arg);
    case 'bin':
      return hasAnyVar(e.a) || hasAnyVar(e.b);
    case 'call':
      return e.args.some((a, i) => !(i === 0 && isFluidArg(e)) && hasAnyVar(a.value));
    default:
      return false;
  }
}
function isFluidArg(e: Extract<Expr, { kind: 'call' }>): boolean {
  const n = canonFunc(e.name);
  return n in PROP_FUNCS || n in HA_FUNCS;
}

// ---------------------------------------------------------------------------
// Unit check (dimensional analysis).
//
// The dimension of every expression is linear in the (unknown) dimensions of
// the variables: products add, quotients subtract, powers with a constant
// exponent scale. Sums and `=` require both sides to match. That gives a
// linear system whose unknowns are the variable dimensions, solved here by
// incremental Gaussian elimination so that the equation that introduces an
// inconsistency can be pointed out.
//
// A number written without units is "flexible" when it stands alone as a term
// (T = 25, h2 = h1 + 100): it takes whatever dimension the equation needs, and
// we warn because it will be read in SI units (25 -> 25 K).

interface Lin {
  c: Dim; // constant part
  k: Map<number, number>; // unknown id -> coefficient
}
const linConst = (d: Dim): Lin => ({ c: [...d], k: new Map() });
const linUnknown = (id: number): Lin => ({ c: [...DIMLESS], k: new Map([[id, 1]]) });
function linComb(a: Lin, b: Lin, s: number): Lin {
  const k = new Map(a.k);
  for (const [id, v] of b.k) {
    const n = (k.get(id) ?? 0) + s * v;
    if (Math.abs(n) < 1e-12) k.delete(id);
    else k.set(id, n);
  }
  return { c: a.c.map((v, i) => v + s * b.c[i]), k };
}
const linScale = (a: Lin, s: number): Lin => ({ c: a.c.map((v) => v * s), k: new Map([...a.k].map(([id, v]) => [id, v * s])) });

interface Constraint {
  left: Lin;
  right: Lin;
  eq: number;
  pos: Pos;
  what: string; // describes the constraint for messages
}

function constExprValue(e: Expr): number | null {
  switch (e.kind) {
    case 'num':
      return e.value;
    case 'var': {
      const c = CONSTANTS[e.name.toLowerCase()];
      return c ? c.value : null;
    }
    case 'neg': {
      const v = constExprValue(e.arg);
      return v === null ? null : -v;
    }
    case 'bin': {
      const a = constExprValue(e.a);
      const b = constExprValue(e.b);
      if (a === null || b === null) return null;
      return e.op === '+' ? a + b : e.op === '-' ? a - b : e.op === '*' ? a * b : e.op === '/' ? a / b : Math.pow(a, b);
    }
    default:
      return null;
  }
}

function checkUnits(model: Model) {
  const nv = model.vars.length;
  const free: { pos: Pos; raw: string; value: number; eq: number }[] = [];
  const cons: Constraint[] = [];
  const offsetWarnings: Diagnostic[] = [];

  function lin(e: Expr, asTerm: boolean, eq: number): Lin {
    switch (e.kind) {
      case 'num':
        if (e.dim) return linConst(e.dim);
        if (asTerm) {
          free.push({ pos: e.pos, raw: e.raw, value: e.value, eq });
          return linUnknown(nv + free.length - 1);
        }
        return linConst(DIMLESS);
      case 'str':
        return linConst(DIMLESS);
      case 'var': {
        const i = model.index.get(e.name.toLowerCase());
        if (i === undefined) return linConst(CONSTANTS[e.name.toLowerCase()]?.dim ?? DIMLESS);
        return linUnknown(i);
      }
      case 'neg':
        return lin(e.arg, asTerm, eq);
      case 'bin': {
        if (e.op === '+' || e.op === '-') {
          for (const t of [e.a, e.b]) {
            const lit = t.kind === 'neg' ? t.arg : t;
            if (lit.kind === 'num' && lit.offset)
              offsetWarnings.push({
                severity: 'warning',
                message: `${lit.raw} [${lit.unitText}] dentro de una suma o resta se convierte a temperatura absoluta (${lit.value.toFixed(2)} K). Para una diferencia de temperatura usa [K] o [delta_C].`,
                pos: lit.pos,
                eq,
              });
          }
          const a = lin(e.a, true, eq);
          const b = lin(e.b, true, eq);
          cons.push({ left: a, right: b, eq, pos: e.pos, what: `una ${e.op === '+' ? 'suma' : 'resta'}` });
          return a;
        }
        if (e.op === '*' || e.op === '/') {
          const a = lin(e.a, false, eq);
          const b = lin(e.b, false, eq);
          return linComb(a, b, e.op === '*' ? 1 : -1);
        }
        // power
        const k = constExprValue(e.b);
        const bl = lin(e.b, false, eq);
        cons.push({ left: bl, right: linConst(DIMLESS), eq, pos: e.b.pos, what: 'el exponente (debe ser adimensional)' });
        const a = lin(e.a, false, eq);
        if (k !== null) return linScale(a, k);
        cons.push({ left: a, right: linConst(DIMLESS), eq, pos: e.a.pos, what: 'la base de una potencia con exponente variable (debe ser adimensional)' });
        return linConst(DIMLESS);
      }
      case 'call': {
        const name = canonFunc(e.name);
        const b = BUILTINS[name];
        if (b) {
          const args = e.args.map((a) => lin(a.value, b.dims === 'same', eq));
          if (b.dims === 'dimless') {
            cons.push({ left: args[0], right: linConst(DIMLESS), eq, pos: e.args[0].value.pos, what: `el argumento de ${e.name}() (debe ser adimensional)` });
            return linConst(DIMLESS);
          }
          if (b.dims === 'sqrt') return linScale(args[0], 0.5);
          for (let j = 1; j < args.length; j++) cons.push({ left: args[0], right: args[j], eq, pos: e.pos, what: `los argumentos de ${e.name}()` });
          return args[0];
        }
        const isHA = name in HA_FUNCS;
        const table = isHA ? HA_INPUTS : INPUTS;
        for (const a of e.args.slice(1)) {
          const key = canonInput(a.key!, isHA);
          cons.push({
            left: lin(a.value, true, eq),
            right: linConst(table[key].dim),
            eq,
            pos: a.value.pos,
            what: `la entrada ${a.key}= de ${e.name}() (${table[key].label})`,
          });
        }
        return linConst(isHA ? HA_FUNCS[name].dim : PROP_FUNCS[name].dim);
      }
    }
  }

  model.eqs.forEach((me, i) => {
    const l = lin(me.eq.lhs, true, i);
    const r = lin(me.eq.rhs, true, i);
    cons.push({ left: l, right: r, eq: i, pos: me.eq.pos, what: 'los dos lados de la ecuación' });
  });

  // ---- incremental elimination ----
  const N = nv + free.length;
  interface Row {
    a: Float64Array;
    b: number[]; // 7 rhs
    piv: number;
  }
  const rows: Row[] = [];
  const conflicts: Constraint[] = [];
  for (const c of cons) {
    const diff = linComb(c.left, c.right, -1);
    const a = new Float64Array(N);
    for (const [id, v] of diff.k) a[id] = v;
    const b = diff.c.map((v) => -v);
    for (const r of rows) {
      const f = a[r.piv];
      if (f !== 0) {
        const s = f / r.a[r.piv];
        for (let j = 0; j < N; j++) a[j] -= s * r.a[j];
        for (let j = 0; j < 7; j++) b[j] -= s * r.b[j];
        a[r.piv] = 0;
      }
    }
    let piv = -1;
    let best = 1e-9;
    for (let j = 0; j < N; j++)
      if (Math.abs(a[j]) > best) {
        best = Math.abs(a[j]);
        piv = j;
      }
    if (piv < 0) {
      if (b.some((v) => Math.abs(v) > 1e-9)) conflicts.push(c);
      continue;
    }
    rows.push({ a, b, piv });
  }
  // back substitution → reduced row echelon form
  for (let i = rows.length - 1; i >= 0; i--) {
    const r = rows[i];
    const p = r.a[r.piv];
    for (let j = 0; j < N; j++) r.a[j] /= p;
    for (let j = 0; j < 7; j++) r.b[j] /= p;
    for (let k = 0; k < i; k++) {
      const q = rows[k];
      const f = q.a[r.piv];
      if (f !== 0) {
        for (let j = 0; j < N; j++) q.a[j] -= f * r.a[j];
        for (let j = 0; j < 7; j++) q.b[j] -= f * r.b[j];
      }
    }
  }
  const known: (Dim | null)[] = new Array(N).fill(null);
  for (const r of rows) {
    let determined = true;
    for (let j = 0; j < N; j++) if (j !== r.piv && Math.abs(r.a[j]) > 1e-9) determined = false;
    if (determined) known[r.piv] = r.b.map((v) => (Math.abs(v - Math.round(v)) < 1e-9 ? Math.round(v) + 0 : v));
  }
  model.vars.forEach((v, i) => (v.dim = known[i]));

  const evalLin = (l: Lin): Dim | null => {
    let d = [...l.c];
    for (const [id, k] of l.k) {
      const kd = known[id];
      if (!kd) return null;
      d = d.map((v, j) => v + k * kd[j]);
    }
    return d;
  };

  const diags = model.diagnostics;
  diags.push(...offsetWarnings);
  const seen = new Set<number>();
  for (const c of conflicts) {
    if (seen.has(c.eq)) continue;
    seen.add(c.eq);
    const l = evalLin(c.left);
    const r = evalLin(c.right);
    const detail = l && r ? `: [${siString(l)}] frente a [${siString(r)}]` : '';
    diags.push({
      severity: 'warning',
      message: `Unidades inconsistentes en ${c.what}${detail}.`,
      pos: c.pos,
      eq: c.eq,
    });
  }
  free.forEach((f, j) => {
    const d = known[nv + j];
    if (!d || isDimless(d) || f.value === 0 || seen.has(f.eq)) return;
    const u = siString(d);
    const tip = dimEq(d, D.temperature)
      ? ` Si querías grados Celsius escribe ${f.raw} [C].`
      : dimEq(d, D.pressure)
        ? ` Si querías kPa escribe ${f.raw} [kPa].`
        : dimEq(d, D.specEnergy)
          ? ` Si querías kJ/kg escribe ${f.raw} [kJ/kg].`
          : '';
    diags.push({
      severity: 'warning',
      message: `El número ${f.raw} no tiene unidades: se toma como ${f.raw} [${u}] (SI).${tip}`,
      pos: f.pos,
      eq: f.eq,
    });
  });
}
