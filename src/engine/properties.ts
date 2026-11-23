// Thermodynamic property functions (EES-style names) on top of a CoolProp-like backend.

import { D, DIMLESS, type Dim } from './units';

/** Minimal interface we need from CoolProp, so the engine can be tested with a fake. */
export interface PropsBackend {
  PropsSI(out: string, in1: string, v1: number, in2: string, v2: number, fluid: string): number;
  HAPropsSI?(out: string, in1: string, v1: number, in2: string, v2: number, in3: string, v3: number): number;
  get_global_param_string?(key: string): string;
}

/** Input keys accepted inside property calls, e.g. T=..., P=..., x=... */
export const INPUTS: Record<string, { cp: string; dim: Dim; label: string; invert?: boolean }> = {
  t: { cp: 'T', dim: D.temperature, label: 'temperatura' },
  p: { cp: 'P', dim: D.pressure, label: 'presión' },
  h: { cp: 'Hmass', dim: D.specEnergy, label: 'entalpía' },
  s: { cp: 'Smass', dim: D.specEntropy, label: 'entropía' },
  u: { cp: 'Umass', dim: D.specEnergy, label: 'energía interna' },
  x: { cp: 'Q', dim: DIMLESS, label: 'calidad' },
  q: { cp: 'Q', dim: DIMLESS, label: 'calidad' },
  d: { cp: 'Dmass', dim: D.density, label: 'densidad' },
  rho: { cp: 'Dmass', dim: D.density, label: 'densidad' },
  v: { cp: 'Dmass', dim: D.specVolume, label: 'volumen específico', invert: true },
};

export interface PropFn {
  out: string; // CoolProp output key
  dim: Dim;
  invert?: boolean; // return 1/value (specific volume)
  nInputs: 0 | 1 | 2;
  fixed?: { key: string; value: number }; // e.g. T_sat → Q=0
  desc: string;
}

export const PROP_FUNCS: Record<string, PropFn> = {
  enthalpy: { out: 'Hmass', dim: D.specEnergy, nInputs: 2, desc: 'Entalpía específica [J/kg]' },
  entropy: { out: 'Smass', dim: D.specEntropy, nInputs: 2, desc: 'Entropía específica [J/kg-K]' },
  intenergy: { out: 'Umass', dim: D.specEnergy, nInputs: 2, desc: 'Energía interna específica [J/kg]' },
  density: { out: 'Dmass', dim: D.density, nInputs: 2, desc: 'Densidad [kg/m^3]' },
  volume: { out: 'Dmass', dim: D.specVolume, invert: true, nInputs: 2, desc: 'Volumen específico [m^3/kg]' },
  temperature: { out: 'T', dim: D.temperature, nInputs: 2, desc: 'Temperatura [K]' },
  pressure: { out: 'P', dim: D.pressure, nInputs: 2, desc: 'Presión [Pa]' },
  quality: { out: 'Q', dim: DIMLESS, nInputs: 2, desc: 'Calidad (fracción de vapor)' },
  cp: { out: 'Cpmass', dim: D.specEntropy, nInputs: 2, desc: 'Calor específico a presión constante [J/kg-K]' },
  cv: { out: 'Cvmass', dim: D.specEntropy, nInputs: 2, desc: 'Calor específico a volumen constante [J/kg-K]' },
  viscosity: { out: 'V', dim: D.viscosity, nInputs: 2, desc: 'Viscosidad dinámica [Pa-s]' },
  conductivity: { out: 'L', dim: D.conductivity, nInputs: 2, desc: 'Conductividad térmica [W/m-K]' },
  soundspeed: { out: 'A', dim: D.velocity, nInputs: 2, desc: 'Velocidad del sonido [m/s]' },
  prandtl: { out: 'Prandtl', dim: DIMLESS, nInputs: 2, desc: 'Número de Prandtl' },
  t_sat: { out: 'T', dim: D.temperature, nInputs: 1, fixed: { key: 'Q', value: 0 }, desc: 'Temperatura de saturación, T_sat(Fluido, P=...)' },
  p_sat: { out: 'P', dim: D.pressure, nInputs: 1, fixed: { key: 'Q', value: 0 }, desc: 'Presión de saturación, P_sat(Fluido, T=...)' },
  molarmass: { out: 'molar_mass', dim: D.molarMass, nInputs: 0, desc: 'Masa molar [kg/mol]' },
  t_crit: { out: 'Tcrit', dim: D.temperature, nInputs: 0, desc: 'Temperatura crítica [K]' },
  p_crit: { out: 'pcrit', dim: D.pressure, nInputs: 0, desc: 'Presión crítica [Pa]' },
};

/** Humid-air (psychrometric) functions: HumidityRatio(AirH2O, T=, P=, R=) */
export const HA_INPUTS: Record<string, { cp: string; dim: Dim; label: string }> = {
  t: { cp: 'T', dim: D.temperature, label: 'temperatura de bulbo seco' },
  p: { cp: 'P', dim: D.pressure, label: 'presión' },
  r: { cp: 'R', dim: DIMLESS, label: 'humedad relativa (0-1)' },
  w: { cp: 'W', dim: DIMLESS, label: 'relación de humedad' },
  b: { cp: 'B', dim: D.temperature, label: 'bulbo húmedo' },
  d: { cp: 'D', dim: D.temperature, label: 'punto de rocío' },
  h: { cp: 'H', dim: D.specEnergy, label: 'entalpía por kg de aire seco' },
};
export const HA_FUNCS: Record<string, { out: string; dim: Dim; desc: string }> = {
  humrat: { out: 'W', dim: DIMLESS, desc: 'Relación de humedad [kg agua/kg aire seco]' },
  relhum: { out: 'R', dim: DIMLESS, desc: 'Humedad relativa (0-1)' },
  wetbulb: { out: 'B', dim: D.temperature, desc: 'Temperatura de bulbo húmedo [K]' },
  dewpoint: { out: 'D', dim: D.temperature, desc: 'Punto de rocío [K]' },
  enthalpy_ha: { out: 'H', dim: D.specEnergy, desc: 'Entalpía del aire húmedo por kg de aire seco [J/kg]' },
};

/** Fluid name aliases → CoolProp names. Unknown names are passed to CoolProp as written. */
const FLUIDS: Record<string, string> = {
  water: 'Water',
  steam: 'Water',
  h2o: 'Water',
  steam_iapws: 'Water',
  air: 'Air',
  air_ha: 'Air',
  r134a: 'R134a',
  r410a: 'R410A',
  r404a: 'R404A',
  r407c: 'R407C',
  r22: 'R22',
  r32: 'R32',
  r12: 'R12',
  r123: 'R123',
  r1234yf: 'R1234yf',
  r1234ze: 'R1234ze(E)',
  r717: 'Ammonia',
  ammonia: 'Ammonia',
  nh3: 'Ammonia',
  r744: 'CarbonDioxide',
  co2: 'CarbonDioxide',
  carbondioxide: 'CarbonDioxide',
  n2: 'Nitrogen',
  nitrogen: 'Nitrogen',
  o2: 'Oxygen',
  oxygen: 'Oxygen',
  h2: 'Hydrogen',
  hydrogen: 'Hydrogen',
  helium: 'Helium',
  he: 'Helium',
  argon: 'Argon',
  ar: 'Argon',
  methane: 'Methane',
  ch4: 'Methane',
  ethane: 'Ethane',
  propane: 'n-Propane',
  r290: 'n-Propane',
  butane: 'n-Butane',
  isobutane: 'IsoButane',
  r600a: 'IsoButane',
  co: 'CarbonMonoxide',
};
export const HUMID_AIR_NAMES = new Set(['airh2o', 'humidair', 'humid_air']);

export const FLUID_LIST = [
  'Water',
  'Air',
  'R134a',
  'R410A',
  'R22',
  'R32',
  'R1234yf',
  'Ammonia',
  'CO2',
  'Nitrogen',
  'Oxygen',
  'Hydrogen',
  'Methane',
  'Propane',
  'Isobutane',
  'Helium',
  'Argon',
];

export function fluidName(id: string): string {
  return FLUIDS[id.toLowerCase()] ?? id;
}

export function isPropFunction(name: string): boolean {
  const n = name.toLowerCase();
  return n in PROP_FUNCS || n in HA_FUNCS;
}

export class PropertyError extends Error {}

/** Evaluate a property call. `inputs` are [key, SI value] pairs (keys already lower-case and validated). */
export function evalProp(backend: PropsBackend, fn: string, fluid: string, inputs: Array<[string, number]>): number {
  const name = fn.toLowerCase();
  if (name in HA_FUNCS) {
    if (!backend.HAPropsSI) throw new PropertyError('Las propiedades de aire húmedo no están disponibles');
    const f = HA_FUNCS[name];
    const [a, b, c] = inputs;
    const v = backend.HAPropsSI(f.out, HA_INPUTS[a[0]].cp, a[1], HA_INPUTS[b[0]].cp, b[1], HA_INPUTS[c[0]].cp, c[1]);
    if (!Number.isFinite(v)) throw new PropertyError(lastError(backend) || `${fn}: estado fuera de rango`);
    return v;
  }
  const f = PROP_FUNCS[name];
  const cpFluid = fluidName(fluid);
  let v: number;
  if (f.nInputs === 0) {
    v = backend.PropsSI(f.out, '', 0, '', 0, cpFluid);
  } else {
    const pairs: Array<[string, number]> = inputs.map(([k, val]) => {
      const inp = INPUTS[k];
      return [inp.cp, inp.invert ? 1 / val : val];
    });
    if (f.fixed) pairs.push([f.fixed.key, f.fixed.value]);
    v = backend.PropsSI(f.out, pairs[0][0], pairs[0][1], pairs[1][0], pairs[1][1], cpFluid);
  }
  if (!Number.isFinite(v)) {
    throw new PropertyError(lastError(backend) || `${fn}(${fluid}): estado fuera de rango`);
  }
  return f.invert ? 1 / v : v;
}

function lastError(backend: PropsBackend): string {
  try {
    return backend.get_global_param_string?.('errstring') ?? '';
  } catch {
    return '';
  }
}
