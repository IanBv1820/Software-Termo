/// <reference lib="webworker" />
// Runs the engine off the UI thread so long solves/tables never freeze the page.

// @ts-expect-error: the package's typings don't declare the Emscripten factory as default export
import Module from 'coolprop-wasm/coolprop';
import { buildModel, ModelError, runTable, solve, type Diagnostic, type Model, type PropsBackend } from '../engine';
import type { Request, Response, VarOut } from './protocol';

let backend: PropsBackend | null = null;
const post = (m: Response) => (self as unknown as Worker).postMessage(m);

const ready = (Module as unknown as () => Promise<PropsBackend>)()
  .then((cp) => {
    backend = cp;
    // The first property call initialises CoolProp's fluid library (~2 s); do it now, not on the first solve.
    try {
      cp.PropsSI('H', 'T', 300, 'P', 101325, 'Water');
    } catch {
      /* ignore */
    }
    post({ type: 'ready' });
  })
  .catch((e) => post({ type: 'fatal', message: `No se pudo cargar CoolProp: ${e}` }));

function build(src: string): { model?: Model; diagnostics: Diagnostic[] } {
  try {
    const model = buildModel(src, backend);
    return { model, diagnostics: [...model.diagnostics] };
  } catch (e) {
    if (e instanceof ModelError) return { diagnostics: e.diagnostics };
    return { diagnostics: [{ severity: 'error', message: String(e) }] };
  }
}

const toMap = (model: Model, rec: Record<string, number> | undefined) => {
  const m = new Map<number, number>();
  if (!rec) return m;
  for (const [k, v] of Object.entries(rec)) {
    const i = model.index.get(k.toLowerCase());
    if (i !== undefined && Number.isFinite(v)) m.set(i, v);
  }
  return m;
};

const varsOut = (model: Model, values?: Float64Array, block?: Int32Array): VarOut[] =>
  model.vars.map((v, i) => ({ name: v.name, dim: v.dim, guess: v.guess, value: values ? values[i] : NaN, block: block ? block[i] : -1 }));

self.onmessage = async (ev: MessageEvent<Request>) => {
  const req = ev.data;
  if (req.type !== 'check') await ready;
  const { model, diagnostics } = build(req.src);
  if (req.type === 'check') {
    post({ type: 'checked', id: req.id, diagnostics, vars: model ? varsOut(model) : [] });
    return;
  }
  if (!model) {
    post({ type: 'solved', id: req.id, ok: false, diagnostics, vars: [], stats: null });
    return;
  }
  const opts = { guesses: toMap(model, req.guesses), lower: toMap(model, req.lower), upper: toMap(model, req.upper) };
  if (req.type === 'solve') {
    const res = solve(model, opts);
    post({
      type: 'solved',
      id: req.id,
      ok: res.ok,
      diagnostics: [...diagnostics, ...res.diagnostics],
      vars: varsOut(model, res.values, res.block),
      stats: res.stats,
    });
    return;
  }
  if (req.type === 'table') {
    try {
      const rows = runTable(model, req.inputs, opts, (i, row) => post({ type: 'tableRow', id: req.id, index: i, row }));
      post({ type: 'tableDone', id: req.id, rows, diagnostics, vars: varsOut(model) });
    } catch (e) {
      post({ type: 'tableDone', id: req.id, rows: [], diagnostics: [...diagnostics, { severity: 'error', message: e instanceof Error ? e.message : String(e) }], vars: varsOut(model) });
    }
  }
};
