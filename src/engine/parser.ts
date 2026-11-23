// Lexer + parser for the equation language.
//
// The language is deliberately close to EES:
//   - one equation per line (or several separated by `;`), in any order
//   - comments: "text", {text}, // text, # text
//   - numbers may carry units in brackets: 100 [kPa], 9.81 [m/s^2], 25 [C]
//   - functions: sqrt(x), exp(x), ... and property functions such as
//     h1 = enthalpy(Water, T=T1, P=P1)
//   - variable names are case-insensitive (T1 and t1 are the same variable)

import { parseUnit, toSI, UnitError, type Dim } from './units';

export interface Pos {
  line: number; // 1-based
  col: number; // 1-based
  from: number; // absolute offset
  to: number;
}

export type Expr =
  | { kind: 'num'; value: number; dim: Dim | null; unitText?: string; offset?: boolean; raw: string; pos: Pos }
  | { kind: 'var'; name: string; pos: Pos }
  | { kind: 'str'; value: string; pos: Pos }
  | { kind: 'neg'; arg: Expr; pos: Pos }
  | { kind: 'bin'; op: '+' | '-' | '*' | '/' | '^'; a: Expr; b: Expr; pos: Pos }
  | { kind: 'call'; name: string; args: Arg[]; pos: Pos };

export interface Arg {
  key?: string; // named argument, e.g. T in enthalpy(Water, T=T1, P=P1)
  value: Expr;
}

export interface Equation {
  lhs: Expr;
  rhs: Expr;
  pos: Pos;
  text: string; // source text of the equation
}

export class ParseError extends Error {
  constructor(
    message: string,
    public pos: Pos,
  ) {
    super(message);
  }
}

type TokKind = 'num' | 'id' | 'op' | 'unit' | 'str' | 'sep' | 'eof';
interface Tok {
  kind: TokKind;
  text: string;
  pos: Pos;
}

function lex(src: string): Tok[] {
  const toks: Tok[] = [];
  let i = 0;
  let line = 1;
  let lineStart = 0;
  const mk = (kind: TokKind, text: string, from: number, to: number): Tok => ({
    kind,
    text,
    pos: { line, col: from - lineStart + 1, from, to },
  });
  const err = (msg: string, from: number, to = from + 1) =>
    new ParseError(msg, { line, col: from - lineStart + 1, from, to });

  while (i < src.length) {
    const c = src[i];
    if (c === '\n') {
      toks.push(mk('sep', '\n', i, i + 1));
      i++;
      line++;
      lineStart = i;
      continue;
    }
    if (c === ' ' || c === '\t' || c === '\r') {
      i++;
      continue;
    }
    // comments
    if (c === '"' || c === '{') {
      const close = c === '"' ? '"' : '}';
      const start = i;
      i++;
      while (i < src.length && src[i] !== close) {
        if (src[i] === '\n') {
          line++;
          lineStart = i + 1;
        }
        i++;
      }
      if (i >= src.length) throw err(`Comentario sin cerrar: falta ${close}`, start);
      i++;
      continue;
    }
    if ((c === '/' && src[i + 1] === '/') || c === '#') {
      while (i < src.length && src[i] !== '\n') i++;
      continue;
    }
    if (c === ';') {
      toks.push(mk('sep', ';', i, i + 1));
      i++;
      continue;
    }
    if (c === "'") {
      const start = i;
      i++;
      while (i < src.length && src[i] !== "'" && src[i] !== '\n') i++;
      if (src[i] !== "'") throw err("Texto sin cerrar: falta '", start);
      toks.push(mk('str', src.slice(start + 1, i), start, i + 1));
      i++;
      continue;
    }
    if (c === '[') {
      const start = i;
      i++;
      while (i < src.length && src[i] !== ']' && src[i] !== '\n') i++;
      if (src[i] !== ']') throw err('Unidad sin cerrar: falta ]', start);
      toks.push(mk('unit', src.slice(start + 1, i), start, i + 1));
      i++;
      continue;
    }
    const num = /^(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/.exec(src.slice(i));
    if (num) {
      toks.push(mk('num', num[0], i, i + num[0].length));
      i += num[0].length;
      continue;
    }
    const id = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i));
    if (id) {
      toks.push(mk('id', id[0], i, i + id[0].length));
      i += id[0].length;
      continue;
    }
    if ('+-*/^()=,'.includes(c)) {
      toks.push(mk('op', c, i, i + 1));
      i++;
      continue;
    }
    throw err(`Carácter no reconocido "${c}"`, i);
  }
  toks.push({ kind: 'eof', text: '', pos: { line, col: i - lineStart + 1, from: i, to: i } });
  return toks;
}

const span = (a: Pos, b: Pos): Pos => ({ line: a.line, col: a.col, from: a.from, to: b.to });

export function parse(src: string): Equation[] {
  // `**` as power: normalize before lexing (keeps offsets: replace with "^ ")
  const toks = lex(src.replace(/\*\*/g, '^ '));
  let p = 0;
  const peek = () => toks[p];
  const next = () => (toks[p].kind === 'eof' ? toks[p] : toks[p++]);
  const isOp = (t: Tok, s: string) => t.kind === 'op' && t.text === s;
  const expectOp = (s: string) => {
    const t = next();
    if (!isOp(t, s)) throw new ParseError(t.kind === 'eof' || t.kind === 'sep' ? `Se esperaba "${s}" antes del final de la línea` : `Se esperaba "${s}" y se encontró "${t.text}"`, t.pos);
    return t;
  };

  function primary(negate = false): Expr {
    const t = next();
    if (t.kind === 'num') {
      let value = negate ? -Number(t.text) : Number(t.text);
      let offset = false;
      let d: Dim | null = null;
      let unitText: string | undefined;
      let end = t.pos;
      if (peek().kind === 'unit') {
        const u = next();
        unitText = u.text;
        try {
          const ud = parseUnit(u.text);
          value = toSI(value, ud);
          d = ud.dim;
          offset = !!ud.offset;
        } catch (e) {
          if (e instanceof UnitError) throw new ParseError(e.message, u.pos);
          throw e;
        }
        end = u.pos;
      }
      return { kind: 'num', value, dim: d, unitText, offset, raw: (negate ? '-' : '') + t.text, pos: span(t.pos, end) };
    }
    if (t.kind === 'str') return { kind: 'str', value: t.text, pos: t.pos };
    if (t.kind === 'id') {
      if (isOp(peek(), '(')) {
        next();
        const args: Arg[] = [];
        if (!isOp(peek(), ')')) {
          for (;;) {
            // named argument: id '=' expr
            if (peek().kind === 'id' && isOp(toks[p + 1], '=')) {
              const key = next().text;
              next();
              args.push({ key, value: additive() });
            } else {
              args.push({ value: additive() });
            }
            if (isOp(peek(), ',')) {
              next();
              continue;
            }
            break;
          }
        }
        const close = expectOp(')');
        return { kind: 'call', name: t.text, args, pos: span(t.pos, close.pos) };
      }
      if (peek().kind === 'unit') {
        throw new ParseError(`Las unidades [${peek().text}] van después de un número, no de una variable. Escribe por ejemplo 25 [C].`, peek().pos);
      }
      return { kind: 'var', name: t.text, pos: t.pos };
    }
    if (isOp(t, '(')) {
      const e = additive();
      expectOp(')');
      return e;
    }
    if (t.kind === 'eof' || t.kind === 'sep') throw new ParseError('La ecuación termina antes de tiempo', t.pos);
    if (t.kind === 'unit') throw new ParseError(`Unidad [${t.text}] sin un número delante`, t.pos);
    throw new ParseError(`No se esperaba "${t.text}"`, t.pos);
  }

  function power(): Expr {
    const base = primary();
    if (isOp(peek(), '^')) {
      next();
      const exp = unary(); // right associative, allows 2^-1
      return { kind: 'bin', op: '^', a: base, b: exp, pos: span(base.pos, exp.pos) };
    }
    return base;
  }
  function unary(): Expr {
    if (isOp(peek(), '-') && toks[p + 1].kind === 'num' && !isOp(toks[p + 2], '^')) {
      // fold the sign into the literal so that -10 [C] means 263.15 K, not -(283.15 K)
      next();
      return primary(true);
    }
    if (isOp(peek(), '-')) {
      const t = next();
      const a = unary();
      return { kind: 'neg', arg: a, pos: span(t.pos, a.pos) };
    }
    if (isOp(peek(), '+')) {
      next();
      return unary();
    }
    return power();
  }
  function multiplicative(): Expr {
    let a = unary();
    while (isOp(peek(), '*') || isOp(peek(), '/')) {
      const op = next().text as '*' | '/';
      const b = unary();
      a = { kind: 'bin', op, a, b, pos: span(a.pos, b.pos) };
    }
    return a;
  }
  function additive(): Expr {
    let a = multiplicative();
    while (isOp(peek(), '+') || isOp(peek(), '-')) {
      const op = next().text as '+' | '-';
      const b = multiplicative();
      a = { kind: 'bin', op, a, b, pos: span(a.pos, b.pos) };
    }
    return a;
  }

  const eqs: Equation[] = [];
  const errors: ParseError[] = [];
  while (peek().kind !== 'eof') {
    if (peek().kind === 'sep') {
      next();
      continue;
    }
    const start = p;
    try {
      const lhs = additive();
      if (!isOp(peek(), '=')) {
        const t = peek();
        throw new ParseError(
          t.kind === 'sep' || t.kind === 'eof' ? 'Falta el signo "=": cada línea debe ser una ecuación' : `No se esperaba "${t.text}"`,
          t.pos,
        );
      }
      next();
      const rhs = additive();
      const t = peek();
      if (t.kind !== 'sep' && t.kind !== 'eof') throw new ParseError(`No se esperaba "${t.text}" después de la ecuación`, t.pos);
      const pos = span(lhs.pos, rhs.pos);
      eqs.push({ lhs, rhs, pos, text: src.slice(pos.from, pos.to) });
    } catch (e) {
      if (!(e instanceof ParseError)) throw e;
      errors.push(e);
      // skip to the next separator and keep going so we report all errors
      if (p === start) p++;
      while (peek().kind !== 'sep' && peek().kind !== 'eof') p++;
    }
  }
  if (errors.length) throw new ParseErrors(errors);
  return eqs;
}

export class ParseErrors extends Error {
  constructor(public errors: ParseError[]) {
    super(errors.map((e) => `Línea ${e.pos.line}: ${e.message}`).join('\n'));
  }
}
