import { D, dimEq, displayChoices, fromSI, parseUnit, toSI, type Dim } from '../engine';

export type UnitSystem = 'metric' | 'si' | 'english';

const PREFERRED: Record<UnitSystem, Array<[Dim, string]>> = {
  metric: [
    [D.temperature, 'C'],
    [D.pressure, 'kPa'],
    [D.specEnergy, 'kJ/kg'],
    [D.specEntropy, 'kJ/kg-K'],
    [D.power, 'kW'],
    [D.energy, 'kJ'],
  ],
  si: [],
  english: [
    [D.temperature, 'F'],
    [D.pressure, 'psi'],
    [D.specEnergy, 'Btu/lbm'],
    [D.specEntropy, 'Btu/lbm-R'],
    [D.power, 'hp'],
    [D.energy, 'Btu'],
    [D.massFlow, 'lbm/s'],
    [D.density, 'lbm/ft^3'],
    [D.specVolume, 'ft^3/lbm'],
    [D.length, 'ft'],
    [D.area, 'ft^2'],
    [D.volume, 'ft^3'],
    [D.mass, 'lbm'],
    [D.velocity, 'ft/s'],
    [D.force, 'lbf'],
  ],
};

let system: UnitSystem = 'metric';
export function setUnitSystem(s: UnitSystem) {
  system = s;
}

export function defaultUnit(dim: Dim | null, sys: UnitSystem = system): string {
  if (!dim) return '';
  for (const [d, u] of PREFERRED[sys]) if (dimEq(d, dim)) return u;
  return displayChoices(dim)[0];
}

export function unitChoices(dim: Dim | null): string[] {
  return dim ? displayChoices(dim) : [];
}

/** The unit a variable is shown in: the user's pick if it fits the dimension, else the default. */
export function unitFor(dim: Dim | null, pick?: string): string {
  if (!dim) return '';
  if (pick && unitChoices(dim).includes(pick)) return pick;
  return defaultUnit(dim);
}

const cache = new Map<string, ReturnType<typeof parseUnit>>();
const pu = (u: string) => {
  let v = cache.get(u);
  if (!v) cache.set(u, (v = parseUnit(u)));
  return v;
};
export const siToUnit = (v: number, unit: string) => (unit ? fromSI(v, pu(unit)) : v);
export const unitToSi = (v: number, unit: string) => (unit ? toSI(v, pu(unit)) : v);

export function fmt(v: number, digits = 5): string {
  if (!Number.isFinite(v)) return Number.isNaN(v) ? '—' : v > 0 ? '∞' : '-∞';
  if (v === 0) return '0';
  const a = Math.abs(v);
  if (a >= 1e6 || a < 1e-3) return v.toExponential(digits - 1).replace(/\.?0+e/, 'e');
  const s = v.toPrecision(digits);
  return s.includes('.') ? s.replace(/\.?0+$/, '') : s;
}
