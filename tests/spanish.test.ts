import { describe, it, expect, beforeAll } from 'vitest';
// @ts-expect-error: the package's typings don't declare the Emscripten factory as default export
import Module from 'coolprop-wasm/coolprop';
import { buildModel, solve, translateSource, type PropsBackend } from '../src/engine';

let CP: PropsBackend;
beforeAll(async () => {
  CP = (await (Module as any)()) as PropsBackend;
});

describe('español', () => {
  it('acepta funciones y fluidos en español', () => {
    const m = buildModel(
      `T1 = 100 [C]\nh = entalpia(Agua, T=T1, x=1)\nP = P_sat(Vapor, T=T1)\nv = volumen(Aire, T=T1, P=1 [atm])\nw = relacion_humedad(Aire_humedo, T=25 [C], P=1 [atm], HR=0.5)\ny = raiz(4)`,
      CP,
    );
    const r = solve(m);
    expect(r.ok).toBe(true);
    const g = (n: string) => r.values[m.index.get(n)!];
    expect(g('h') / 1000).toBeCloseTo(2675.6, 0);
    expect(g('w')).toBeCloseTo(0.00988, 3);
    expect(g('y')).toBe(2);
    expect(m.diagnostics).toEqual([]);
  });
  it('traduce el texto entre idiomas sin tocar comentarios ni variables', () => {
    const es = `"entalpia del agua"\nh1 = h_esp(Agua, T=T1, P=P1) // enthalpy\nw = relacion_humedad(Aire_humedo, T=T1, P=P1, R=0.5)\nx = raiz(entalpia)\nT1=300[K];P1=1e5`;
    const en = translateSource(es, 'en');
    expect(en).toBe(`"entalpia del agua"\nh1 = enthalpy(Water, T=T1, P=P1) // enthalpy\nw = HumRat(AirH2O, T=T1, P=P1, R=0.5)\nx = sqrt(entalpia)\nT1=300[K];P1=1e5`);
    expect(translateSource(en, 'es')).toBe(es);
  });
  it('usa h_esp, v_esp, u_esp y s_esp como nombres principales', () => {
    const m = buildModel(
      `h = h_esp(Agua, T=100 [C], x=1)\nv = v_esp(Agua, T=100 [C], x=1)\nu = U_esp(Agua, T=100 [C], x=1)\ns = s_esp(Agua, T=100 [C], x=1)\nh2 = entalpia(Agua, T=100 [C], x=1)`,
      CP,
    );
    const r = solve(m);
    expect(r.ok).toBe(true);
    const g = (n: string) => r.values[m.index.get(n)!];
    expect(g('h') / 1000).toBeCloseTo(2675.6, 0);
    expect(g('h2')).toBe(g('h'));
    expect(g('v')).toBeCloseTo(1.672, 2);
    expect(g('u') / 1000).toBeCloseTo(2506, 0);
    expect(g('s') / 1000).toBeCloseTo(7.354, 2);
    expect(m.diagnostics).toEqual([]);
  });
  it('convierte los nombres viejos a los nuevos al traducir', () => {
    const viejo = `a = entalpia(Agua, T=T1, x=1)\nb = volumen(Agua, T=T1, x=1)\nc = energia_interna(Agua, T=T1, x=1)\nd = entropia(Agua, T=T1, x=1)`;
    expect(translateSource(viejo, 'es')).toBe(
      `a = h_esp(Agua, T=T1, x=1)\nb = v_esp(Agua, T=T1, x=1)\nc = u_esp(Agua, T=T1, x=1)\nd = s_esp(Agua, T=T1, x=1)`,
    );
    expect(translateSource(viejo, 'en')).toBe(
      `a = enthalpy(Water, T=T1, x=1)\nb = volume(Water, T=T1, x=1)\nc = intenergy(Water, T=T1, x=1)\nd = entropy(Water, T=T1, x=1)`,
    );
  });
});
