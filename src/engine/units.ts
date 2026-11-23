// Units and dimensions.
//
// Every quantity is stored internally in SI. A dimension is a vector of
// exponents over the 7 SI base quantities. Units are only used when reading a
// number the user wrote (e.g. `100 [kPa]`) and when displaying a result.

export const BASE = ['m', 'kg', 's', 'K', 'mol', 'A', 'cd'] as const;
export type Dim = number[]; // length 7

export const DIMLESS: Dim = [0, 0, 0, 0, 0, 0, 0];

export const dim = (m = 0, kg = 0, s = 0, K = 0, mol = 0, A = 0, cd = 0): Dim => [m, kg, s, K, mol, A, cd];

export const dimAdd = (a: Dim, b: Dim): Dim => a.map((v, i) => v + b[i]);
export const dimSub = (a: Dim, b: Dim): Dim => a.map((v, i) => v - b[i]);
export const dimScale = (a: Dim, k: number): Dim => a.map((v) => v * k);
export const dimEq = (a: Dim, b: Dim, tol = 1e-9): boolean => a.every((v, i) => Math.abs(v - b[i]) < tol);
export const isDimless = (a: Dim): boolean => dimEq(a, DIMLESS);

export interface UnitDef {
  factor: number; // SI value of 1 unit
  offset?: number; // SI = value*factor + offset (only for absolute temperatures)
  dim: Dim;
}

// Dimensions used often
export const D = {
  length: dim(1),
  mass: dim(0, 1),
  time: dim(0, 0, 1),
  temperature: dim(0, 0, 0, 1),
  amount: dim(0, 0, 0, 0, 1),
  area: dim(2),
  volume: dim(3),
  velocity: dim(1, 0, -1),
  accel: dim(1, 0, -2),
  force: dim(1, 1, -2),
  pressure: dim(-1, 1, -2),
  energy: dim(2, 1, -2),
  power: dim(2, 1, -3),
  specEnergy: dim(2, 0, -2), // J/kg
  specEntropy: dim(2, 0, -2, -1), // J/kg-K
  density: dim(-3, 1),
  specVolume: dim(3, -1),
  massFlow: dim(0, 1, -1),
  volFlow: dim(3, 0, -1),
  viscosity: dim(-1, 1, -1), // Pa-s
  conductivity: dim(1, 1, -3, -1), // W/m-K
  molarMass: dim(0, 1, 0, 0, -1),
  heatTransferCoef: dim(0, 1, -3, -1), // W/m2-K
  frequency: dim(0, 0, -1),
};

const U: Record<string, UnitDef> = {};
const def = (names: string[], factor: number, d: Dim, offset?: number) => {
  for (const n of names) U[n] = { factor, dim: d, offset };
};

// dimensionless
def(['-', '1'], 1, DIMLESS);
def(['%'], 0.01, DIMLESS);
def(['rad'], 1, DIMLESS);
def(['deg'], Math.PI / 180, DIMLESS);
// length
def(['m'], 1, D.length);
def(['km'], 1e3, D.length);
def(['cm'], 1e-2, D.length);
def(['mm'], 1e-3, D.length);
def(['um', 'µm', 'micron'], 1e-6, D.length);
def(['in', 'inch'], 0.0254, D.length);
def(['ft'], 0.3048, D.length);
def(['yd'], 0.9144, D.length);
def(['mi', 'mile'], 1609.344, D.length);
// mass
def(['kg'], 1, D.mass);
def(['g'], 1e-3, D.mass);
def(['mg'], 1e-6, D.mass);
def(['tonne', 't'], 1e3, D.mass);
def(['lbm', 'lb'], 0.45359237, D.mass);
// time
def(['s', 'sec'], 1, D.time);
def(['ms'], 1e-3, D.time);
def(['min'], 60, D.time);
def(['h', 'hr'], 3600, D.time);
def(['day'], 86400, D.time);
// temperature (absolute; offsets apply only to plain values, see toSI)
def(['K'], 1, D.temperature);
def(['C', 'degC', '°C'], 1, D.temperature, 273.15);
def(['F', 'degF', '°F'], 5 / 9, D.temperature, 273.15 - (32 * 5) / 9);
def(['R', 'degR'], 5 / 9, D.temperature);
// temperature differences
def(['delta_C', 'deltaC', 'dC'], 1, D.temperature);
def(['delta_F', 'deltaF', 'dF'], 5 / 9, D.temperature);
// amount
def(['mol'], 1, D.amount);
def(['kmol'], 1e3, D.amount);
def(['lbmol'], 453.59237, D.amount);
// area / volume
def(['L', 'l', 'liter'], 1e-3, D.volume);
def(['mL', 'ml'], 1e-6, D.volume);
def(['gal'], 3.785411784e-3, D.volume);
// force
def(['N'], 1, D.force);
def(['kN'], 1e3, D.force);
def(['lbf'], 4.4482216152605, D.force);
// pressure
def(['Pa'], 1, D.pressure);
def(['kPa'], 1e3, D.pressure);
def(['MPa'], 1e6, D.pressure);
def(['GPa'], 1e9, D.pressure);
def(['bar'], 1e5, D.pressure);
def(['mbar'], 100, D.pressure);
def(['atm'], 101325, D.pressure);
def(['psi', 'psia'], 6894.757293168, D.pressure);
def(['mmHg', 'torr'], 133.322387415, D.pressure);
// energy
def(['J'], 1, D.energy);
def(['kJ'], 1e3, D.energy);
def(['MJ'], 1e6, D.energy);
def(['Wh'], 3600, D.energy);
def(['kWh'], 3.6e6, D.energy);
def(['cal'], 4.184, D.energy);
def(['kcal'], 4184, D.energy);
def(['Btu', 'BTU'], 1055.05585262, D.energy);
// power
def(['W'], 1, D.power);
def(['kW'], 1e3, D.power);
def(['MW'], 1e6, D.power);
def(['hp'], 745.69987158, D.power);
def(['ton_ref', 'TR'], 3516.8528421, D.power);
// misc
def(['Hz'], 1, D.frequency);
def(['rpm'], 1 / 60, D.frequency);

export function hasUnit(name: string): boolean {
  return name in U;
}

export class UnitError extends Error {}

/**
 * Parse a unit expression such as `kJ/kg-K`, `m/s^2`, `kg*m^2`, `W/(m^2*K)`.
 * `-` and `*` and `·` mean multiplication (EES style `kJ/kg-K` = kJ/(kg*K)):
 * everything after the first `/` is in the denominator unless parentheses are used.
 */
export function parseUnit(text: string): UnitDef {
  const src = text.trim();
  if (src === '' || src === '-') return { factor: 1, dim: DIMLESS };
  let i = 0;
  const peek = () => src[i];
  const skipWs = () => {
    while (i < src.length && src[i] === ' ') i++;
  };

  // product := factor (('*'|'-'|'·'|' ') factor)*
  // expr    := product ('/' product)*   (EES style: a/b-c = a/(b*c))
  function parseExpr(): UnitDef {
    let num = parseProduct();
    skipWs();
    while (peek() === '/') {
      i++;
      const den = parseProduct();
      num = combine(num, den, -1);
      skipWs();
    }
    return num;
  }
  function parseProduct(): UnitDef {
    let acc = parseFactor();
    for (;;) {
      skipWs();
      const c = peek();
      if (c === '*' || c === '·' || c === '-') {
        i++;
        acc = combine(acc, parseFactor(), 1);
      } else if (c !== undefined && /[A-Za-zµ°%(]/.test(c)) {
        acc = combine(acc, parseFactor(), 1);
      } else break;
    }
    return acc;
  }
  function parseFactor(): UnitDef {
    skipWs();
    let base: UnitDef;
    if (peek() === '(') {
      i++;
      base = parseExpr();
      skipWs();
      if (peek() !== ')') throw new UnitError(`Falta ')' en la unidad [${text}]`);
      i++;
    } else {
      const m = /^([A-Za-zµ°%_]+[0-9]?)/.exec(src.slice(i));
      // allow a trailing digit as exponent shorthand only when it is not a unit name (m2 -> m^2)
      let name = m ? m[1] : '';
      let exp = 1;
      if (name && !(name in U) && /[0-9]$/.test(name) && name.slice(0, -1) in U) {
        exp = Number(name.slice(-1));
        name = name.slice(0, -1);
        i += 1;
      }
      if (!name) {
        if (/^1/.test(src.slice(i))) {
          i++;
          return { factor: 1, dim: DIMLESS };
        }
        throw new UnitError(`Unidad no válida: [${text}]`);
      }
      i += name.length;
      const u = U[name];
      if (!u) throw new UnitError(`Unidad desconocida "${name}" en [${text}]`);
      base = { factor: Math.pow(u.factor, exp), dim: dimScale(u.dim, exp), offset: exp === 1 ? u.offset : undefined };
    }
    skipWs();
    if (peek() === '^') {
      i++;
      skipWs();
      const m = /^-?[0-9]+(\.[0-9]+)?/.exec(src.slice(i));
      if (!m) throw new UnitError(`Exponente no válido en [${text}]`);
      i += m[0].length;
      const e = Number(m[0]);
      base = { factor: Math.pow(base.factor, e), dim: dimScale(base.dim, e) };
    }
    return base;
  }
  function combine(a: UnitDef, b: UnitDef, sign: 1 | -1): UnitDef {
    // offsets only survive for a lone temperature unit
    return { factor: a.factor * Math.pow(b.factor, sign), dim: dimAdd(a.dim, dimScale(b.dim, sign)) };
  }

  const res = parseExpr();
  skipWs();
  if (i < src.length) throw new UnitError(`No se entiende "${src.slice(i)}" en la unidad [${text}]`);
  return res;
}

/** Convert a value written in `unit` to SI. */
export function toSI(value: number, unit: UnitDef): number {
  return value * unit.factor + (unit.offset ?? 0);
}
/** Convert an SI value to `unit`. */
export function fromSI(value: number, unit: UnitDef): number {
  return (value - (unit.offset ?? 0)) / unit.factor;
}

// ---------- display ----------

/** Units offered in the results dropdown for each dimension (first = default). */
const DISPLAY_CHOICES: Array<[Dim, string[]]> = [
  [DIMLESS, ['-', '%']],
  [D.temperature, ['K', 'C', 'F', 'R']],
  [D.pressure, ['Pa', 'kPa', 'MPa', 'bar', 'atm', 'psi']],
  [D.specEnergy, ['J/kg', 'kJ/kg', 'Btu/lbm']],
  [D.specEntropy, ['J/kg-K', 'kJ/kg-K', 'Btu/lbm-R']],
  [D.energy, ['J', 'kJ', 'MJ', 'kWh', 'Btu']],
  [D.power, ['W', 'kW', 'MW', 'hp', 'Btu/hr', 'TR']],
  [D.massFlow, ['kg/s', 'kg/min', 'kg/h', 'lbm/s', 'lbm/hr']],
  [D.volFlow, ['m^3/s', 'L/s', 'm^3/h', 'L/min']],
  [D.density, ['kg/m^3', 'g/cm^3', 'lbm/ft^3']],
  [D.specVolume, ['m^3/kg', 'L/kg', 'ft^3/lbm']],
  [D.length, ['m', 'mm', 'cm', 'km', 'in', 'ft']],
  [D.area, ['m^2', 'cm^2', 'mm^2', 'ft^2', 'in^2']],
  [D.volume, ['m^3', 'L', 'cm^3', 'ft^3', 'gal']],
  [D.mass, ['kg', 'g', 'lbm']],
  [D.time, ['s', 'min', 'h']],
  [D.velocity, ['m/s', 'km/h', 'ft/s']],
  [D.accel, ['m/s^2']],
  [D.force, ['N', 'kN', 'lbf']],
  [D.viscosity, ['Pa-s', 'mPa-s']],
  [D.conductivity, ['W/m-K']],
  [D.heatTransferCoef, ['W/m^2-K']],
  [D.molarMass, ['kg/mol', 'kg/kmol', 'g/mol']],
  [dim(2, 1, -2, -1), ['J/K', 'kJ/K']], // entropy
  [dim(2, 1, -3, -1), ['W/K', 'kW/K']], // entropy rate / UA
  [dim(2, 1, -2, -1, -1), ['J/mol-K', 'kJ/kmol-K']],
  [D.frequency, ['Hz', 'rpm']],
];
// mPa isn't defined as a unit name; add it.
U['mPa'] = { factor: 1e-3, dim: D.pressure };

export function displayChoices(d: Dim): string[] {
  for (const [dd, list] of DISPLAY_CHOICES) if (dimEq(dd, d)) return list;
  return [siString(d)];
}

/** A readable SI string for any dimension, e.g. kg/m^3, m^2/s^2-K */
export function siString(d: Dim): string {
  for (const [dd, list] of DISPLAY_CHOICES) if (dimEq(dd, d)) return list[0];
  const fmt = (n: string, e: number) => (Math.abs(e - 1) < 1e-9 ? n : `${n}^${+e.toFixed(3)}`);
  const num: string[] = [];
  const den: string[] = [];
  d.forEach((e, k) => {
    if (Math.abs(e) < 1e-9) return;
    (e > 0 ? num : den).push(fmt(BASE[k], Math.abs(e)));
  });
  if (!num.length && !den.length) return '-';
  return (num.length ? num.join('-') : '1') + (den.length ? '/' + den.join('-') : '');
}
