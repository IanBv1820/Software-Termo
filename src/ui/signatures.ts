// Function catalog for the editor: names, aliases, search keywords and
// argument signatures. Used by the autocompletion (ranking and the info box)
// and by the argument hint shown while typing inside a call.

import { FUNC_ES, HA_FUNCS, PROP_FUNCS, fluidLabel, funcName, type Lang } from '../engine';

export type FnKind = 'prop' | 'ha' | 'math';

export interface Param {
  name: string; // shown in the signature, e.g. "Fluido" or "T=…"
  doc?: string;
}

export interface FnInfo {
  canon: string; // canonical (English, lower-case) name
  kind: FnKind;
  name: string; // name in the chosen language
  aliases: string[]; // every other accepted name
  keywords: string[]; // extra words to search by (from the description)
  desc: string;
  params: Param[];
  variadic?: boolean; // min/max
  inputs?: Array<[string, string]>; // valid property inputs [key, meaning]
  nInputs?: number;
  example: string;
  note?: string;
}

/** lower-case and drop accents: "Entalpía" -> "entalpia" */
export function norm(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

const STOP = new Set(['de', 'del', 'la', 'el', 'los', 'las', 'por', 'kg', 'a', 'y', 'en', 'con', 'fluido']);
function words(desc: string): string[] {
  return norm(desc.replace(/\[[^\]]*\]|\([^)]*\)/g, ' '))
    .split(/[^a-z0-9_]+/)
    .filter((w) => w.length > 2 && !STOP.has(w));
}

const PROP_INPUTS_ES: Array<[string, string]> = [
  ['T', 'temperatura'],
  ['P', 'presión'],
  ['h', 'entalpía'],
  ['s', 'entropía'],
  ['u', 'energía interna'],
  ['x', 'calidad (0–1)'],
  ['v', 'volumen específico'],
  ['d', 'densidad'],
];
const PROP_INPUTS_EN: Array<[string, string]> = [
  ['T', 'temperature'],
  ['P', 'pressure'],
  ['h', 'enthalpy'],
  ['s', 'entropy'],
  ['u', 'internal energy'],
  ['x', 'quality (0–1)'],
  ['v', 'specific volume'],
  ['d', 'density'],
];
const HA_INPUTS_ES: Array<[string, string]> = [
  ['T', 'bulbo seco'],
  ['P', 'presión'],
  ['HR', 'humedad relativa (0–1)'],
  ['w', 'relación de humedad'],
  ['BH', 'bulbo húmedo'],
  ['PR', 'punto de rocío'],
  ['h', 'entalpía'],
];
const HA_INPUTS_EN: Array<[string, string]> = [
  ['T', 'dry bulb'],
  ['P', 'pressure'],
  ['R', 'relative humidity (0–1)'],
  ['W', 'humidity ratio'],
  ['B', 'wet bulb'],
  ['D', 'dew point'],
  ['h', 'enthalpy'],
];

/** Which two inputs the example uses, so it reads naturally for each output. */
const EXAMPLE_INPUTS: Record<string, string> = {
  temperature: 'P=P1, h=h1',
  pressure: 'T=T1, v=v1',
  quality: 'P=P1, h=h1',
};

const MATH: Array<{ canon: string; es: string; params: string[]; desc: string; descEn: string; variadic?: boolean }> = [
  { canon: 'sqrt', es: 'raiz', params: ['x'], desc: 'Raíz cuadrada', descEn: 'Square root' },
  { canon: 'exp', es: 'exp', params: ['x'], desc: 'Exponencial, e^x', descEn: 'Exponential, e^x' },
  { canon: 'ln', es: 'ln', params: ['x'], desc: 'Logaritmo natural', descEn: 'Natural logarithm' },
  { canon: 'log10', es: 'log10', params: ['x'], desc: 'Logaritmo en base 10', descEn: 'Base-10 logarithm' },
  { canon: 'sin', es: 'sen', params: ['x'], desc: 'Seno (x en radianes)', descEn: 'Sine (x in radians)' },
  { canon: 'cos', es: 'cos', params: ['x'], desc: 'Coseno (x en radianes)', descEn: 'Cosine (x in radians)' },
  { canon: 'tan', es: 'tan', params: ['x'], desc: 'Tangente (x en radianes)', descEn: 'Tangent (x in radians)' },
  { canon: 'abs', es: 'abs', params: ['x'], desc: 'Valor absoluto', descEn: 'Absolute value' },
  { canon: 'min', es: 'min', params: ['a', 'b'], desc: 'El menor de los valores', descEn: 'Smallest of the values', variadic: true },
  { canon: 'max', es: 'max', params: ['a', 'b'], desc: 'El mayor de los valores', descEn: 'Largest of the values', variadic: true },
];

function aliasesOf(canon: string, primary: string): string[] {
  const all = new Set<string>([...Object.keys(FUNC_ES).filter((k) => FUNC_ES[k] === canon), canon]);
  const out: string[] = [];
  for (const a of all) if (a.toLowerCase() !== primary.toLowerCase()) out.push(a);
  return out;
}

const cache = new Map<Lang, FnInfo[]>();

export function functionCatalog(lang: Lang): FnInfo[] {
  const hit = cache.get(lang);
  if (hit) return hit;
  const es = lang === 'es';
  const fluid = es ? 'Fluido' : 'Fluid';
  const water = fluidLabel('Water', lang);
  const ha = fluidLabel('AirH2O', lang);
  const list: FnInfo[] = [];

  for (const [canon, f] of Object.entries(PROP_FUNCS)) {
    const name = funcName(canon, lang);
    const base: FnInfo = {
      canon,
      kind: 'prop',
      name,
      aliases: aliasesOf(canon, name),
      keywords: words(f.desc),
      desc: f.desc.replace(/,\s*[TP]_sat\(.*\)$/, ''),
      params: [{ name: fluid, doc: es ? 'nombre del fluido, p. ej. ' + water : 'fluid name, e.g. ' + water }],
      nInputs: f.nInputs,
      example: '',
    };
    if (f.nInputs === 2) {
      base.params.push({ name: es ? 'entrada1' : 'input1' }, { name: es ? 'entrada2' : 'input2' });
      base.inputs = es ? PROP_INPUTS_ES : PROP_INPUTS_EN;
      base.example = `${name}(${water}, ${EXAMPLE_INPUTS[canon] ?? 'T=T1, P=P1'})`;
      base.note = es
        ? 'Da dos propiedades independientes con nombre=valor. Ej.: T y P, o P y x (mezcla saturada).'
        : 'Give two independent properties as name=value. E.g. T and P, or P and x (saturated mixture).';
    } else if (f.nInputs === 1) {
      const inp = canon === 't_sat' ? 'P' : 'T';
      base.params.push({ name: `${inp}=…` });
      base.example = `${name}(${water}, ${inp}=${inp}1)`;
      base.note = es ? `Solo necesita ${inp === 'P' ? 'la presión' : 'la temperatura'}.` : `Only needs the ${inp === 'P' ? 'pressure' : 'temperature'}.`;
    } else {
      base.example = `${name}(${water})`;
      base.note = es ? 'Solo necesita el fluido.' : 'Only needs the fluid.';
    }
    list.push(base);
  }

  for (const [canon, f] of Object.entries(HA_FUNCS)) {
    const name = funcName(canon, lang);
    list.push({
      canon,
      kind: 'ha',
      name,
      aliases: aliasesOf(canon, name),
      keywords: words(f.desc),
      desc: f.desc,
      params: [
        { name: ha, doc: es ? 'siempre aire húmedo' : 'always humid air' },
        { name: es ? 'entrada1' : 'input1' },
        { name: es ? 'entrada2' : 'input2' },
        { name: es ? 'entrada3' : 'input3' },
      ],
      inputs: es ? HA_INPUTS_ES : HA_INPUTS_EN,
      nInputs: 3,
      example: `${name}(${ha}, T=T1, P=1 [atm], ${es ? 'HR' : 'R'}=0.6)`,
      note: es ? 'Aire húmedo: da tres entradas con nombre=valor (normalmente T, P y HR).' : 'Humid air: give three inputs as name=value (usually T, P and R).',
    });
  }

  for (const m of MATH) {
    const name = es ? m.es : m.canon;
    list.push({
      canon: m.canon,
      kind: 'math',
      name,
      aliases: m.es !== m.canon ? [es ? m.canon : m.es] : [],
      keywords: words(es ? m.desc : m.descEn),
      desc: es ? m.desc : m.descEn,
      params: m.params.map((p) => ({ name: p })),
      variadic: m.variadic,
      example: `${name}(${m.params.join(', ')})`,
    });
  }

  cache.set(lang, list);
  return list;
}

/** Find a function by any accepted name (any case, any language). */
export function findFunction(word: string, lang: Lang): FnInfo | undefined {
  const w = word.toLowerCase();
  return functionCatalog(lang).find((f) => f.name.toLowerCase() === w || f.aliases.some((a) => a.toLowerCase() === w));
}

/** Text of each parameter slot as shown in the signature line. */
export function paramLabels(f: FnInfo): string[] {
  const out = f.params.map((p) => p.name);
  if (f.variadic) out.push('…');
  return out;
}

export interface Match {
  score: number;
  via?: string; // alias or keyword that matched, when not the name itself
  primary?: boolean; // the name itself matched
}

/**
 * How well a typed word matches a function. Higher is better; 0 = no match.
 *   3 the name or another accepted name starts with it ·
 *   2 a word of the description starts with it · 1 name contains it
 * A typed "ent" matches h_esp (alias "entalpia") as well as entalpia_ha, so the
 * kind of function (KIND_RANK) decides between them, not which name matched.
 */
export function matchFunction(f: FnInfo, typed: string): Match {
  const q = norm(typed);
  if (!q) return { score: 1 };
  if (norm(f.name).startsWith(q)) return { score: 3, primary: true };
  const alias = f.aliases.find((a) => norm(a).startsWith(q));
  if (alias) return { score: 3, via: alias };
  if (q.length >= 3) {
    const kw = f.keywords.find((k) => k.startsWith(q));
    if (kw) return { score: 2, via: kw };
  }
  if (q.length >= 2 && norm(f.name).includes(q)) return { score: 1 };
  return { score: 0 };
}

/** Rank so the plain (pure fluid) property comes before the humid-air one. */
export const KIND_RANK: Record<FnKind, number> = { prop: 0, ha: 1, math: 2 };

/**
 * Find the function call that encloses `pos` on its line, and which argument
 * the cursor is in. Returns null outside a call (or inside a comment).
 */
export function enclosingCall(lineText: string, col: number): { name: string; arg: number; nameStart: number } | null {
  const before = lineText.slice(0, col);
  // ignore comments: "..." / {...} blocks and // or # to end of line
  let clean = '';
  let inC: string | null = null;
  for (let i = 0; i < before.length; i++) {
    const c = before[i];
    if (inC) {
      if (c === inC) inC = null;
      clean += ' ';
      continue;
    }
    if (c === '"') inC = '"';
    else if (c === '{') inC = '}';
    else if (c === '#' || (c === '/' && before[i + 1] === '/')) return null;
    else if (c === '[') inC = ']';
    clean += inC ? ' ' : c;
  }
  if (inC && inC !== ']') return null;
  let depth = 0;
  let arg = 0;
  for (let i = clean.length - 1; i >= 0; i--) {
    const c = clean[i];
    if (c === ')') depth++;
    else if (c === '(') {
      if (depth === 0) {
        const m = /([A-Za-z_][A-Za-z0-9_]*)\s*$/.exec(clean.slice(0, i));
        if (!m) return null;
        return { name: m[1], arg, nameStart: m.index };
      }
      depth--;
    } else if (c === ',' && depth === 0) arg++;
  }
  return null;
}
