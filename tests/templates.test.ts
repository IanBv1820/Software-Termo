import { describe, it, expect, beforeAll } from 'vitest';
// @ts-expect-error: the package's typings don't declare the Emscripten factory as default export
import Module from 'coolprop-wasm/coolprop';
import { buildModel, solve, type PropsBackend } from '../src/engine';
import { TEMPLATES, defaultValues, makeWriter } from '../src/ui/templates';

let CP: PropsBackend;
beforeAll(async () => {
  CP = (await (Module as any)()) as PropsBackend;
});

describe('plantillas del asistente', () => {
  for (const t of TEMPLATES)
    for (const lang of ['es', 'en'] as const)
      it(`${t.title} (${lang}) se resuelve sin avisos`, () => {
        const v = defaultValues(t);
        expect(t.validate?.(v) ?? null).toBeNull();
        const src = t.build(v, makeWriter(v, lang));
        const m = buildModel(src, CP);
        const r = solve(m);
        expect(r.diagnostics).toEqual([]);
        expect(m.diagnostics).toEqual([]);
        expect(r.ok).toBe(true);
      });
  it('estado con calidad y presión', () => {
    const t = TEMPLATES.find((x) => x.id === 'estado')!;
    const v = defaultValues(t);
    v.p1 = { value: 'x', unit: '' };
    v.v1 = { value: '0.5', unit: '-' };
    const r = solve(buildModel(t.build(v, makeWriter(v, 'es')), CP));
    expect(r.ok).toBe(true);
  });
});
