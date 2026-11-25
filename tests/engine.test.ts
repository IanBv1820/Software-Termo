import { describe, it, expect, beforeAll } from 'vitest';
// @ts-expect-error: the package's typings don't declare the Emscripten factory as default export
import Module from 'coolprop-wasm/coolprop';
import { buildModel, solve, runTable, linspace, parseUnit, toSI, fromSI, ModelError, type PropsBackend } from '../src/engine';

let CP: PropsBackend;
beforeAll(async () => {
  CP = (await (Module as any)()) as PropsBackend;
});

const run = (src: string) => {
  const m = buildModel(src, CP);
  const r = solve(m);
  const get = (n: string) => r.values[m.index.get(n)!];
  return { m, r, get };
};

describe('units', () => {
  it('parses compound units', () => {
    expect(parseUnit('kJ/kg-K').factor).toBe(1000);
    expect(parseUnit('kJ/kg-K').dim).toEqual([2, 0, -2, -1, 0, 0, 0]);
    expect(parseUnit('m/s^2').dim).toEqual([1, 0, -2, 0, 0, 0, 0]);
    expect(parseUnit('W/(m^2*K)').dim).toEqual([0, 1, -3, -1, 0, 0, 0]);
    expect(toSI(25, parseUnit('C'))).toBeCloseTo(298.15);
    expect(fromSI(373.15, parseUnit('F'))).toBeCloseTo(212);
    expect(() => parseUnit('kgg')).toThrow();
  });
});

describe('solver', () => {
  it('solves equations in any order', () => {
    const { r, get } = run(`
      y = 2*x + z
      z = 3
      x^2 + y^2 = 100   "coupled with the first"
    `);
    expect(r.ok).toBe(true);
    const x = get('x');
    expect(x * x + (2 * x + 3) ** 2).toBeCloseTo(100, 8);
  });

  it('handles explicit chains', () => {
    const { r, get } = run('A = 2\nb = A*3\nC = b + A');
    expect(r.ok).toBe(true);
    expect(get('C')).toBe(8);
  });

  it('treats upper and lower case as different variables', () => {
    const { m, r, get } = run('T = 300 [K]\nt = 2 [s]\nP = 5\np = P + T/1[K]');
    expect(r.ok).toBe(true);
    expect(m.vars.length).toBe(4);
    expect(get('T')).toBe(300);
    expect(get('t')).toBe(2);
    expect(get('p')).toBe(305);
    expect(m.index.get('P')).not.toBe(m.index.get('p'));
  });

  it('still accepts functions, fluids and property inputs in any case', () => {
    const { r, get } = run("T1 = 100 [C]\nP1 = 1 [atm]\nh1 = ENTHALPY(WATER, t=T1, p=P1)\nx = SQRT(4) + PI - pi");
    expect(r.ok).toBe(true);
    expect(get('h1')).toBeGreaterThan(4e5);
    expect(get('x')).toBeCloseTo(2);
  });

  it('reports missing equations', () => {
    const { r } = run('x + y = 3');
    expect(r.ok).toBe(false);
    expect(r.diagnostics[0].message).toMatch(/faltan 1/);
  });

  it('reports extra equations', () => {
    const { r } = run('x = 3\nx = 4');
    expect(r.ok).toBe(false);
    expect(r.diagnostics[0].message).toMatch(/sobran 1/);
  });

  it('reports syntax errors with line numbers', () => {
    try {
      buildModel('x = 3\ny = (x + 2', CP);
      throw new Error('should fail');
    } catch (e) {
      expect(e).toBeInstanceOf(ModelError);
      expect((e as ModelError).diagnostics[0].pos?.line).toBe(2);
    }
  });
});

describe('unit check', () => {
  it('infers units of variables', () => {
    const { m } = run('m = 2 [kg]\nv = 3 [m/s]\nKE = 0.5*m*v^2');
    const ke = m.vars[m.index.get('KE')!];
    expect(ke.dim!.map((v) => v + 0)).toEqual([2, 1, -2, 0, 0, 0, 0]);
    expect(m.diagnostics).toHaveLength(0);
  });
  it('flags inconsistent sums', () => {
    const { m } = run('a = 2 [kg]\nb = 3 [m]\nc = a + b');
    expect(m.diagnostics.some((d) => d.severity === 'warning' && /inconsistentes/.test(d.message))).toBe(true);
  });
  it('warns about numbers without units', () => {
    const { m } = run('T = 25\nh = enthalpy(Water, T=T, P=1 [atm])');
    expect(m.diagnostics.some((d) => /25 \[K\]/.test(d.message) && /\[C\]/.test(d.message))).toBe(true);
  });
});

describe('properties', () => {
  it('water saturation', () => {
    const { r, get } = run('h = enthalpy(Water, T=100 [C], x=1)\nP = P_sat(Water, T=100 [C])');
    expect(r.ok).toBe(true);
    expect(get('h') / 1000).toBeCloseTo(2675.6, 0);
    expect(get('P') / 1000).toBeCloseTo(101.4, 0);
  });

  it('solves implicitly for a property input', () => {
    // find T such that h = 3000 kJ/kg at 1 MPa (superheated)
    const { r, get } = run('h = 3000 [kJ/kg]\nh = enthalpy(Steam, T=T, P=1 [MPa])');
    expect(r.ok).toBe(true);
    expect(CP.PropsSI('H', 'T', get('T'), 'P', 1e6, 'Water')).toBeCloseTo(3e6, 0);
  });

  it('Rankine cycle', () => {
    const { r, get, m } = run(`
      P[1] = 10 [kPa]
    `.replace('P[1]', 'P1') + `
      x1 = 0
      h1 = enthalpy(Water, P=P1, x=x1)
      v1 = volume(Water, P=P1, x=x1)
      s1 = entropy(Water, P=P1, x=x1)
      P2 = 8 [MPa]
      w_p = v1*(P2 - P1)
      h2 = h1 + w_p
      T3 = 480 [C]
      P3 = P2
      h3 = enthalpy(Water, T=T3, P=P3)
      s3 = entropy(Water, T=T3, P=P3)
      P4 = P1
      s4 = s3
      h4 = enthalpy(Water, P=P4, s=s4)
      x4 = quality(Water, P=P4, s=s4)
      q_in = h3 - h2
      w_t = h3 - h4
      eta = (w_t - w_p)/q_in
    `);
    expect(r.ok).toBe(true);
    expect(get('eta')).toBeGreaterThan(0.37);
    expect(get('eta')).toBeLessThan(0.40);
    expect(m.diagnostics.filter((d) => d.severity !== 'info')).toEqual([]);
  });

  it('refrigeration cycle with R134a and humid air', () => {
    const { r, get } = run(`
      T_evap = -10 [C]
      h1 = enthalpy(R134a, T=T_evap, x=1)
      P_cond = 1 [MPa]
      W = HumRat(AirH2O, T=25 [C], P=1 [atm], R=0.5)
    `);
    expect(r.ok).toBe(true);
    expect(get('h1') / 1000).toBeGreaterThan(380);
    expect(get('W')).toBeCloseTo(0.00988, 3);
  });

  it('gives a readable error when a property is out of range', () => {
    const { r } = run('h = enthalpy(Water, T=-50 [C], P=1 [atm])');
    expect(r.ok).toBe(false);
    expect(r.diagnostics[0].message).toMatch(/Propiedad|rango|T/);
  });
});

describe('parametric table', () => {
  it('overrides the fixing equation and sweeps', () => {
    const m = buildModel('T = 100 [C]\nP = P_sat(Water, T=T)', CP);
    const rows = runTable(m, [{ name: 'T', values: linspace(373.15, 473.15, 5) }]);
    expect(rows.every((r) => r.ok)).toBe(true);
    expect(rows[0].values.P / 1000).toBeCloseTo(101.4, 0);
    expect(rows[4].values.P / 1e6).toBeCloseTo(1.554, 2);
  });
  it('explains when an input variable is computed by the equations', () => {
    const m = buildModel('T = 2*y\ny = 3', CP);
    const rows = runTable(m, [{ name: 'T', values: [1, 2] }]);
    expect(rows[0].ok).toBe(false);
    expect(rows[0].error).toMatch(/quita esa variable/);
  });
});

import { EXAMPLES } from '../src/ui/examples';
describe('examples', () => {
  for (const ex of EXAMPLES) {
    it(`solves "${ex.title}" without warnings`, () => {
      const { r, m } = run(ex.src);
      expect(r.diagnostics).toEqual([]);
      expect(m.diagnostics).toEqual([]);
      expect(r.ok).toBe(true);
      if (ex.id !== 'no-lineal') expect(m.vars.every((v) => v.dim !== null)).toBe(true);
    });
  }
  it('negative temperatures with offset units', () => {
    const { get, m } = run('T = -10 [C]\nT2 = T + 5 [C]');
    expect(get('T')).toBeCloseTo(263.15);
    expect(m.diagnostics.some((d) => /delta_C/.test(d.message))).toBe(true);
  });
});
