// Problem templates used by the assistant. Each one asks for a few data and
// writes commented equations in the language chosen in Preferences.

import { D, DIMLESS, funcName, fluidLabel, type Dim, type Lang } from '../engine';

export type DimKey = 'temperature' | 'pressure' | 'specEnergy' | 'specEntropy' | 'dimless' | 'power' | 'massFlow' | 'volume';
export const DIMS: Record<DimKey, Dim> = {
  temperature: D.temperature,
  pressure: D.pressure,
  specEnergy: D.specEnergy,
  specEntropy: D.specEntropy,
  dimless: DIMLESS,
  power: D.power,
  massFlow: D.massFlow,
  volume: D.volume,
};

export type Values = Record<string, { value: string; unit: string }>;

export interface Field {
  key: string;
  label: string;
  kind: 'number' | 'fluid' | 'choice';
  /** default value; numbers are given in `unit` (metric) */
  def: number | string;
  unit?: string;
  dim?: DimKey | ((v: Values) => DimKey);
  options?: { value: string; label: string }[];
  help?: string;
}

export interface Template {
  id: string;
  title: string;
  desc: string;
  assumptions: string[];
  fields: Field[];
  validate?: (v: Values) => string | null;
  build: (v: Values, w: Writer) => string;
}

/** Helpers handed to `build` so templates stay language-neutral. */
export interface Writer {
  f: (canon: string) => string; // function name
  fl: (fluidEn: string) => string; // fluid name
  q: (key: string) => string; // value with units, e.g. "300 [kPa]"
  s: (key: string) => string; // raw string value (fluid / choice)
}

export function makeWriter(v: Values, lang: Lang): Writer {
  return {
    f: (c) => funcName(c, lang),
    fl: (en) => fluidLabel(en, lang),
    q: (k) => {
      const { value, unit } = v[k];
      return unit && unit !== '-' ? `${value} [${unit}]` : value;
    },
    s: (k) => v[k].value,
  };
}

const WORKING_FLUIDS = ['Water', 'Air', 'R134a', 'R410A', 'R22', 'R32', 'R1234yf', 'Ammonia', 'CO2', 'Nitrogen', 'Propane'];
const REFRIGERANTS = ['R134a', 'R410A', 'R22', 'R32', 'R1234yf', 'Ammonia', 'Propane', 'CO2'];

const STATE_PROPS: Record<string, { canon: string; label: string; dim: DimKey; def: number; unit: string; var: string }> = {
  T: { canon: 'temperature', label: 'Temperatura', dim: 'temperature', def: 200, unit: 'C', var: 'T' },
  P: { canon: 'pressure', label: 'Presión', dim: 'pressure', def: 500, unit: 'kPa', var: 'P' },
  x: { canon: 'quality', label: 'Calidad (0 = líquido saturado, 1 = vapor saturado)', dim: 'dimless', def: 1, unit: '-', var: 'x' },
  h: { canon: 'enthalpy', label: 'Entalpía', dim: 'specEnergy', def: 2800, unit: 'kJ/kg', var: 'h' },
  s: { canon: 'entropy', label: 'Entropía', dim: 'specEntropy', def: 7, unit: 'kJ/kg-K', var: 's' },
};
const propOptions = Object.entries(STATE_PROPS).map(([k, p]) => ({ value: k, label: p.label.replace(/ \(.*/, '') }));

export const TEMPLATES: Template[] = [
  {
    id: 'estado',
    title: 'Propiedades de un estado',
    desc: 'Conoces dos datos de una sustancia (por ejemplo T y P) y quieres todas sus propiedades.',
    assumptions: ['Sustancia pura en equilibrio.', 'Si das la calidad, el estado es una mezcla saturada.'],
    fields: [
      { key: 'fluid', label: 'Sustancia', kind: 'fluid', def: 'Water', options: WORKING_FLUIDS.map((f) => ({ value: f, label: f })) },
      { key: 'p1', label: 'Primer dato', kind: 'choice', def: 'T', options: propOptions },
      { key: 'v1', label: 'Valor del primer dato', kind: 'number', def: 200, unit: 'C', dim: (v) => STATE_PROPS[v.p1.value].dim },
      { key: 'p2', label: 'Segundo dato', kind: 'choice', def: 'P', options: propOptions },
      { key: 'v2', label: 'Valor del segundo dato', kind: 'number', def: 500, unit: 'kPa', dim: (v) => STATE_PROPS[v.p2.value].dim },
    ],
    validate: (v) => (v.p1.value === v.p2.value ? 'Elige dos datos distintos: con uno solo no se puede fijar el estado.' : null),
    build: (v, w) => {
      const a = STATE_PROPS[v.p1.value];
      const b = STATE_PROPS[v.p2.value];
      const F = w.fl(v.fluid.value);
      const lines = [`"Estado de ${F}: datos conocidos"`, `${a.var} = ${w.q('v1')}`, `${b.var} = ${w.q('v2')}`, '', '"Propiedades calculadas"'];
      const known = `${a.var}=${a.var}, ${b.var}=${b.var}`;
      const out: [string, string][] = [
        ['T', 'temperature'],
        ['P', 'pressure'],
        ['h', 'enthalpy'],
        ['s', 'entropy'],
        ['u', 'intenergy'],
        ['v', 'volume'],
        ['x', 'quality'],
      ];
      for (const [name, canon] of out) {
        if (name === a.var || name === b.var) continue;
        lines.push(`${name} = ${w.f(canon)}(${F}, ${known})`);
      }
      lines.push('', '"Nota: la calidad x sale -1 cuando el estado no es una mezcla (líquido comprimido o vapor sobrecalentado)."');
      return lines.join('\n') + '\n';
    },
  },
  {
    id: 'turbina',
    title: 'Turbina',
    desc: 'Vapor o gas que se expande y produce trabajo. Calcula la salida real y la potencia.',
    assumptions: ['Flujo estable, adiabática.', 'Se desprecian cambios de energía cinética y potencial.', 'La eficiencia isentrópica compara con una expansión ideal.'],
    fields: [
      { key: 'fluid', label: 'Fluido', kind: 'fluid', def: 'Water', options: WORKING_FLUIDS.map((f) => ({ value: f, label: f })) },
      { key: 'P1', label: 'Presión de entrada', kind: 'number', def: 3000, unit: 'kPa', dim: 'pressure' },
      { key: 'T1', label: 'Temperatura de entrada', kind: 'number', def: 400, unit: 'C', dim: 'temperature' },
      { key: 'P2', label: 'Presión de salida', kind: 'number', def: 50, unit: 'kPa', dim: 'pressure' },
      { key: 'eta', label: 'Eficiencia isentrópica (0 a 1)', kind: 'number', def: 0.85, unit: '-', dim: 'dimless' },
      { key: 'm', label: 'Flujo másico', kind: 'number', def: 10, unit: 'kg/s', dim: 'massFlow' },
    ],
    build: (v, w) => {
      const F = w.fl(v.fluid.value);
      return `"Turbina adiabática con eficiencia isentrópica"

"1: entrada"
P1 = ${w.q('P1')}
T1 = ${w.q('T1')}
h1 = ${w.f('enthalpy')}(${F}, T=T1, P=P1)
s1 = ${w.f('entropy')}(${F}, T=T1, P=P1)

"2s: salida ideal, con la misma entropía que la entrada"
P2 = ${w.q('P2')}
s2s = s1
h2s = ${w.f('enthalpy')}(${F}, P=P2, s=s2s)

"2: salida real"
eta_turbina = ${w.q('eta')}
eta_turbina = (h1 - h2)/(h1 - h2s)
T2 = ${w.f('temperature')}(${F}, P=P2, h=h2)
x2 = ${w.f('quality')}(${F}, P=P2, h=h2)

"Primera ley: potencia producida"
m_dot = ${w.q('m')}
W_turbina = m_dot*(h1 - h2)
`;
    },
  },
  {
    id: 'compresor',
    title: 'Compresor',
    desc: 'Gas o refrigerante que se comprime. Calcula la temperatura de salida y la potencia necesaria.',
    assumptions: ['Flujo estable, adiabático.', 'Se desprecian cambios de energía cinética y potencial.'],
    fields: [
      { key: 'fluid', label: 'Fluido', kind: 'fluid', def: 'Air', options: WORKING_FLUIDS.map((f) => ({ value: f, label: f })) },
      { key: 'P1', label: 'Presión de entrada', kind: 'number', def: 100, unit: 'kPa', dim: 'pressure' },
      { key: 'T1', label: 'Temperatura de entrada', kind: 'number', def: 25, unit: 'C', dim: 'temperature' },
      { key: 'P2', label: 'Presión de salida', kind: 'number', def: 800, unit: 'kPa', dim: 'pressure' },
      { key: 'eta', label: 'Eficiencia isentrópica (0 a 1)', kind: 'number', def: 0.8, unit: '-', dim: 'dimless' },
      { key: 'm', label: 'Flujo másico', kind: 'number', def: 1, unit: 'kg/s', dim: 'massFlow' },
    ],
    build: (v, w) => {
      const F = w.fl(v.fluid.value);
      return `"Compresor adiabático con eficiencia isentrópica"

"1: entrada"
P1 = ${w.q('P1')}
T1 = ${w.q('T1')}
h1 = ${w.f('enthalpy')}(${F}, T=T1, P=P1)
s1 = ${w.f('entropy')}(${F}, T=T1, P=P1)

"2s: salida ideal, con la misma entropía que la entrada"
P2 = ${w.q('P2')}
s2s = s1
h2s = ${w.f('enthalpy')}(${F}, P=P2, s=s2s)

"2: salida real"
eta_compresor = ${w.q('eta')}
eta_compresor = (h2s - h1)/(h2 - h1)
T2 = ${w.f('temperature')}(${F}, P=P2, h=h2)

"Primera ley: potencia que consume"
m_dot = ${w.q('m')}
W_compresor = m_dot*(h2 - h1)
`;
    },
  },
  {
    id: 'valvula',
    title: 'Válvula de estrangulamiento',
    desc: 'Un fluido pasa por una válvula y baja su presión sin trabajo ni calor (entalpía constante).',
    assumptions: ['Adiabática y sin trabajo: h2 = h1.'],
    fields: [
      { key: 'fluid', label: 'Fluido', kind: 'fluid', def: 'R134a', options: WORKING_FLUIDS.map((f) => ({ value: f, label: f })) },
      { key: 'P1', label: 'Presión de entrada', kind: 'number', def: 800, unit: 'kPa', dim: 'pressure' },
      { key: 'x1', label: 'Calidad a la entrada (0 = líquido saturado)', kind: 'number', def: 0, unit: '-', dim: 'dimless' },
      { key: 'P2', label: 'Presión de salida', kind: 'number', def: 140, unit: 'kPa', dim: 'pressure' },
    ],
    build: (v, w) => {
      const F = w.fl(v.fluid.value);
      return `"Válvula de estrangulamiento: la entalpía se conserva"

"1: entrada"
P1 = ${w.q('P1')}
x1 = ${w.q('x1')}
h1 = ${w.f('enthalpy')}(${F}, P=P1, x=x1)
T1 = ${w.f('temperature')}(${F}, P=P1, x=x1)

"2: salida"
P2 = ${w.q('P2')}
h2 = h1
T2 = ${w.f('temperature')}(${F}, P=P2, h=h2)
x2 = ${w.f('quality')}(${F}, P=P2, h=h2)
`;
    },
  },
  {
    id: 'intercambiador',
    title: 'Intercambiador de calor (agua)',
    desc: 'Agua caliente le pasa calor a agua fría. Calcula el calor y la temperatura de salida del agua fría.',
    assumptions: ['Sin pérdidas al ambiente.', 'Presión constante en ambos lados.'],
    fields: [
      { key: 'P', label: 'Presión de trabajo', kind: 'number', def: 101.325, unit: 'kPa', dim: 'pressure' },
      { key: 'mc', label: 'Flujo de agua caliente', kind: 'number', def: 2, unit: 'kg/s', dim: 'massFlow' },
      { key: 'Tc1', label: 'Entrada del agua caliente', kind: 'number', def: 80, unit: 'C', dim: 'temperature' },
      { key: 'Tc2', label: 'Salida del agua caliente', kind: 'number', def: 50, unit: 'C', dim: 'temperature' },
      { key: 'mf', label: 'Flujo de agua fría', kind: 'number', def: 3, unit: 'kg/s', dim: 'massFlow' },
      { key: 'Tf1', label: 'Entrada del agua fría', kind: 'number', def: 15, unit: 'C', dim: 'temperature' },
    ],
    build: (_v, w) => {
      const F = w.fl('Water');
      return `"Intercambiador de calor agua-agua"

P = ${w.q('P')}

"Lado caliente"
m_caliente = ${w.q('mc')}
T_c_ent = ${w.q('Tc1')}
T_c_sal = ${w.q('Tc2')}
h_c_ent = ${w.f('enthalpy')}(${F}, T=T_c_ent, P=P)
h_c_sal = ${w.f('enthalpy')}(${F}, T=T_c_sal, P=P)

"Lado frío"
m_fria = ${w.q('mf')}
T_f_ent = ${w.q('Tf1')}
h_f_ent = ${w.f('enthalpy')}(${F}, T=T_f_ent, P=P)
T_f_sal = ${w.f('temperature')}(${F}, h=h_f_sal, P=P)

"Balance de energía: el calor que pierde uno lo gana el otro"
Q = m_caliente*(h_c_ent - h_c_sal)
Q = m_fria*(h_f_sal - h_f_ent)
`;
    },
  },
  {
    id: 'rankine',
    title: 'Ciclo Rankine',
    desc: 'Planta de vapor simple: bomba, caldera, turbina y condensador. Calcula eficiencia y flujo de vapor.',
    assumptions: ['Líquido saturado a la salida del condensador.', 'Bomba y turbina adiabáticas con sus eficiencias.', 'Sin caídas de presión en caldera ni condensador.'],
    fields: [
      { key: 'Pc', label: 'Presión de la caldera', kind: 'number', def: 8000, unit: 'kPa', dim: 'pressure' },
      { key: 'Tc', label: 'Temperatura a la salida de la caldera', kind: 'number', def: 480, unit: 'C', dim: 'temperature' },
      { key: 'Pk', label: 'Presión del condensador', kind: 'number', def: 10, unit: 'kPa', dim: 'pressure' },
      { key: 'et', label: 'Eficiencia de la turbina', kind: 'number', def: 0.85, unit: '-', dim: 'dimless' },
      { key: 'eb', label: 'Eficiencia de la bomba', kind: 'number', def: 0.8, unit: '-', dim: 'dimless' },
      { key: 'W', label: 'Potencia neta deseada', kind: 'number', def: 100, unit: 'MW', dim: 'power' },
    ],
    build: (_v, w) => {
      const F = w.fl('Water');
      return `"Ciclo Rankine simple con eficiencias de turbina y bomba"

"1: salida del condensador (líquido saturado)"
P1 = ${w.q('Pk')}
h1 = ${w.f('enthalpy')}(${F}, P=P1, x=0)
s1 = ${w.f('entropy')}(${F}, P=P1, x=0)

"2: salida de la bomba"
P2 = ${w.q('Pc')}
h2s = ${w.f('enthalpy')}(${F}, P=P2, s=s1)
eta_bomba = ${w.q('eb')}
eta_bomba = (h2s - h1)/(h2 - h1)

"3: salida de la caldera"
P3 = P2
T3 = ${w.q('Tc')}
h3 = ${w.f('enthalpy')}(${F}, T=T3, P=P3)
s3 = ${w.f('entropy')}(${F}, T=T3, P=P3)

"4: salida de la turbina"
P4 = P1
h4s = ${w.f('enthalpy')}(${F}, P=P4, s=s3)
eta_turbina = ${w.q('et')}
eta_turbina = (h3 - h4)/(h3 - h4s)
x4 = ${w.f('quality')}(${F}, P=P4, h=h4)

"Balances por kg de vapor"
w_bomba = h2 - h1
w_turbina = h3 - h4
q_entrada = h3 - h2
eta_ciclo = (w_turbina - w_bomba)/q_entrada

"Flujo de vapor para la potencia pedida"
W_neta = ${w.q('W')}
W_neta = m_dot*(w_turbina - w_bomba)
`;
    },
  },
  {
    id: 'refrigeracion',
    title: 'Ciclo de refrigeración',
    desc: 'Refrigerador o aire acondicionado por compresión de vapor. Calcula COP, potencia y flujo de refrigerante.',
    assumptions: ['Vapor saturado a la entrada del compresor.', 'Líquido saturado a la salida del condensador.', 'Válvula de expansión isoentálpica.'],
    fields: [
      { key: 'fluid', label: 'Refrigerante', kind: 'fluid', def: 'R134a', options: REFRIGERANTS.map((f) => ({ value: f, label: f })) },
      { key: 'Te', label: 'Temperatura del evaporador', kind: 'number', def: -10, unit: 'C', dim: 'temperature' },
      { key: 'Tk', label: 'Temperatura del condensador', kind: 'number', def: 40, unit: 'C', dim: 'temperature' },
      { key: 'eta', label: 'Eficiencia del compresor', kind: 'number', def: 0.8, unit: '-', dim: 'dimless' },
      { key: 'Q', label: 'Capacidad de enfriamiento', kind: 'number', def: 10, unit: 'kW', dim: 'power' },
    ],
    build: (v, w) => {
      const F = w.fl(v.fluid.value);
      return `"Ciclo de refrigeración por compresión de vapor"

T_evap = ${w.q('Te')}
T_cond = ${w.q('Tk')}
P_evap = ${w.f('pressure')}(${F}, T=T_evap, x=1)
P_cond = ${w.f('pressure')}(${F}, T=T_cond, x=0)

"1: entrada del compresor (vapor saturado)"
h1 = ${w.f('enthalpy')}(${F}, T=T_evap, x=1)
s1 = ${w.f('entropy')}(${F}, T=T_evap, x=1)

"2: salida del compresor"
h2s = ${w.f('enthalpy')}(${F}, P=P_cond, s=s1)
eta_compresor = ${w.q('eta')}
eta_compresor = (h2s - h1)/(h2 - h1)
T2 = ${w.f('temperature')}(${F}, P=P_cond, h=h2)

"3: salida del condensador (líquido saturado)"
h3 = ${w.f('enthalpy')}(${F}, T=T_cond, x=0)

"4: después de la válvula"
h4 = h3
x4 = ${w.f('quality')}(${F}, P=P_evap, h=h4)

"Balances"
Q_evap = ${w.q('Q')}
Q_evap = m_dot*(h1 - h4)
W_compresor = m_dot*(h2 - h1)
Q_cond = m_dot*(h2 - h3)
COP = Q_evap/W_compresor
`;
    },
  },
  {
    id: 'gas-ideal',
    title: 'Gas ideal en un tanque',
    desc: 'Masa de gas en un recipiente a partir de presión, temperatura y volumen (P·V = m·R·T).',
    assumptions: ['Comportamiento de gas ideal.', 'R del gas = constante universal / masa molar.'],
    fields: [
      { key: 'fluid', label: 'Gas', kind: 'fluid', def: 'Air', options: ['Air', 'Nitrogen', 'Oxygen', 'CO2', 'Helium', 'Hydrogen', 'Methane', 'Argon'].map((f) => ({ value: f, label: f })) },
      { key: 'P', label: 'Presión', kind: 'number', def: 500, unit: 'kPa', dim: 'pressure' },
      { key: 'T', label: 'Temperatura', kind: 'number', def: 25, unit: 'C', dim: 'temperature' },
      { key: 'V', label: 'Volumen del tanque', kind: 'number', def: 2, unit: 'm^3', dim: 'volume' },
    ],
    build: (v, w) => {
      const F = w.fl(v.fluid.value);
      return `"Gas ideal: P*V = m*R*T"

P = ${w.q('P')}
T = ${w.q('T')}
V = ${w.q('V')}

R_u = 8.314 [J/mol-K]
M_molar = ${w.f('molarmass')}(${F})
R = R_u/M_molar

P*V = m*R*T
`;
    },
  },
  {
    id: 'aire-humedo',
    title: 'Aire húmedo',
    desc: 'Propiedades psicrométricas del aire a partir de temperatura y humedad relativa.',
    assumptions: ['Mezcla de aire seco y vapor de agua.'],
    fields: [
      { key: 'T', label: 'Temperatura de bulbo seco', kind: 'number', def: 30, unit: 'C', dim: 'temperature' },
      { key: 'HR', label: 'Humedad relativa (0 a 1)', kind: 'number', def: 0.6, unit: '-', dim: 'dimless' },
      { key: 'P', label: 'Presión atmosférica', kind: 'number', def: 101.325, unit: 'kPa', dim: 'pressure' },
    ],
    build: (_v, w) => {
      const F = w.fl('AirH2O');
      return `"Aire húmedo"

T_bs = ${w.q('T')}
HR = ${w.q('HR')}
P = ${w.q('P')}

w = ${w.f('humrat')}(${F}, T=T_bs, P=P, R=HR)
T_bh = ${w.f('wetbulb')}(${F}, T=T_bs, P=P, R=HR)
T_rocio = ${w.f('dewpoint')}(${F}, T=T_bs, P=P, R=HR)
h = ${w.f('enthalpy_ha')}(${F}, T=T_bs, P=P, R=HR)
`;
    },
  },
];

/** Dimension of a field given the current values. */
export function fieldDim(f: Field, v: Values): Dim | null {
  if (f.kind !== 'number' || !f.dim) return null;
  return DIMS[typeof f.dim === 'function' ? f.dim(v) : f.dim];
}

/** Default value/unit for a dependent field when its property changes. */
export function stateDefault(prop: string): { value: number; unit: string } {
  const p = STATE_PROPS[prop];
  return { value: p.def, unit: p.unit };
}

/** Template defaults, in the template's own (metric) units. */
export function defaultValues(t: Template): Values {
  const v: Values = {};
  for (const f of t.fields) v[f.key] = { value: String(f.def), unit: f.unit ?? '' };
  return v;
}
