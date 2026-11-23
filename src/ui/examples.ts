export interface Example {
  id: string;
  title: string;
  src: string;
  table?: { columns: { name: string; input: boolean; from?: number; to?: number }[]; rows: number; x?: string; y?: string[] };
}

export const EXAMPLES: Example[] = [
  {
    id: 'rankine',
    title: 'Ciclo Rankine ideal (agua)',
    src: `"Ciclo Rankine ideal simple. Las ecuaciones pueden ir en cualquier orden."

"Estado 1: salida del condensador, líquido saturado"
P1 = 10 [kPa]
h1 = enthalpy(Water, P=P1, x=0)
v1 = volume(Water, P=P1, x=0)
s1 = entropy(Water, P=P1, x=0)

"Bomba isentrópica"
P2 = 8 [MPa]
w_bomba = v1*(P2 - P1)
h2 = h1 + w_bomba

"Caldera"
T3 = 480 [C]
P3 = P2
h3 = enthalpy(Water, T=T3, P=P3)
s3 = entropy(Water, T=T3, P=P3)

"Turbina isentrópica"
P4 = P1
s4 = s3
h4 = enthalpy(Water, P=P4, s=s4)
x4 = quality(Water, P=P4, s=s4)

"Balance de energía"
q_entrada = h3 - h2
w_turbina = h3 - h4
w_neto = w_turbina - w_bomba
eta = w_neto/q_entrada

"Potencia para un flujo dado"
m_dot = 50 [kg/s]
W_neta = m_dot*w_neto
`,
    table: {
      columns: [
        { name: 'T3', input: true, from: 350, to: 600 },
        { name: 'eta', input: false },
        { name: 'x4', input: false },
      ],
      rows: 11,
      x: 'T3',
      y: ['eta'],
    },
  },
  {
    id: 'refrigeracion',
    title: 'Refrigeración por compresión (R134a)',
    src: `"Ciclo de refrigeración por compresión de vapor con eficiencia isentrópica"

T_evap = -10 [C]
P_cond = 1 [MPa]
eta_comp = 0.8
Q_evap = 10 [kW]

"1: vapor saturado a la entrada del compresor"
h1 = enthalpy(R134a, T=T_evap, x=1)
s1 = entropy(R134a, T=T_evap, x=1)
P1 = pressure(R134a, T=T_evap, x=1)

"2: salida del compresor"
h2s = enthalpy(R134a, P=P_cond, s=s1)
eta_comp = (h2s - h1)/(h2 - h1)
T2 = temperature(R134a, P=P_cond, h=h2)

"3: líquido saturado a la salida del condensador"
h3 = enthalpy(R134a, P=P_cond, x=0)

"4: válvula de expansión (isoentálpica)"
h4 = h3

"Balances"
Q_evap = m_dot*(h1 - h4)
W_comp = m_dot*(h2 - h1)
COP = Q_evap/W_comp
`,
    table: {
      columns: [
        { name: 'T_evap', input: true, from: -30, to: 5 },
        { name: 'COP', input: false },
        { name: 'W_comp', input: false },
      ],
      rows: 8,
      x: 'T_evap',
      y: ['COP'],
    },
  },
  {
    id: 'no-lineal',
    title: 'Sistema no lineal acoplado',
    src: `"Tres ecuaciones no lineales acopladas, escritas en desorden"
x^2 + y^2 + z^2 = 14
x*y*z = 6
x + y = z
`,
  },
  {
    id: 'tobera',
    title: 'Tobera de aire (unidades mixtas)',
    src: `"Tobera adiabática: el aire entra lento y sale acelerado.
 Prueba cambiar las unidades de los resultados con el menú de cada fila."

P1 = 300 [kPa]
T1 = 200 [C]
Vel1 = 30 [m/s]
A1 = 80 [cm^2]
P2 = 100 [kPa]
Vel2 = 180 [m/s]

h1 = enthalpy(Air, T=T1, P=P1)
rho1 = density(Air, T=T1, P=P1)
m_dot = rho1*A1*Vel1

"Balance de energía"
h1 + Vel1^2/2 = h2 + Vel2^2/2
T2 = temperature(Air, h=h2, P=P2)
rho2 = density(Air, h=h2, P=P2)
m_dot = rho2*A2*Vel2
`,
  },
  {
    id: 'psicrometria',
    title: 'Aire húmedo (psicrometría)',
    src: `"Propiedades de aire húmedo a 1 atm"
P = 1 [atm]
T_bs = 30 [C]
HR = 0.6

w = HumRat(AirH2O, T=T_bs, P=P, R=HR)
T_bh = WetBulb(AirH2O, T=T_bs, P=P, R=HR)
T_rocio = DewPoint(AirH2O, T=T_bs, P=P, R=HR)
h = Enthalpy_HA(AirH2O, T=T_bs, P=P, R=HR)
`,
    table: {
      columns: [
        { name: 'T_bs', input: true, from: 10, to: 40 },
        { name: 'w', input: false },
        { name: 'T_bh', input: false },
      ],
      rows: 7,
      x: 'T_bs',
      y: ['w'],
    },
  },
];
