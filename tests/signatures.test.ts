import { describe, expect, it } from 'vitest';
import { enclosingCall, findFunction, functionCatalog, KIND_RANK, matchFunction } from '../src/ui/signatures';

function rank(typed: string) {
  return functionCatalog('es')
    .map((f, i) => ({ f, i, m: matchFunction(f, typed) }))
    .filter((x) => x.m.score)
    .sort((a, b) => b.m.score - a.m.score || KIND_RANK[a.f.kind] - KIND_RANK[b.f.kind] || Number(!!b.m.primary) - Number(!!a.m.primary) || a.i - b.i)
    .map((x) => x.f.name);
}

describe('autocompletado de funciones', () => {
  it('al escribir la propiedad en palabras sugiere primero la normal', () => {
    expect(rank('ent')[0]).toBe('h_esp');
    expect(rank('ent').indexOf('h_esp')).toBeLessThan(rank('ent').indexOf('entalpia_ha'));
    expect(rank('entropia')[0]).toBe('s_esp');
    expect(rank('volumen')[0]).toBe('v_esp');
    expect(rank('energia')[0]).toBe('u_esp');
    expect(rank('Entalpía')[0]).toBe('h_esp');
  });
  it('el nombre propio va antes que los alias', () => {
    expect(rank('h_')[0]).toBe('h_esp');
    expect(rank('dens')[0]).toBe('densidad');
  });
});

describe('ayuda de argumentos', () => {
  it('encuentra la llamada y el argumento', () => {
    expect(enclosingCall('h1 = h_esp(Agua, T=T1, ', 23)).toEqual({ name: 'h_esp', arg: 2, nameStart: 5 });
    expect(enclosingCall('x = raiz(abs(y) + ', 18)).toMatchObject({ name: 'raiz', arg: 0 });
    expect(enclosingCall('x = 2 // h_esp(', 15)).toBeNull();
    expect(enclosingCall('T = 25 [C]', 10)).toBeNull();
  });
  it('acepta cualquier nombre de la función', () => {
    expect(findFunction('ENTHALPY', 'es')?.name).toBe('h_esp');
    expect(findFunction('entalpia', 'es')?.name).toBe('h_esp');
    expect(findFunction('T_sat', 'es')?.params.length).toBe(2);
  });
});
